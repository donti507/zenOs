import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, lstat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { MAX_LECTURE_BYTES, MAX_LECTURE_CHUNK_BYTES, MAX_LECTURE_SECONDS } from '../shared/lectures';
export class LectureAudioError extends Error { constructor(message: string, public status = 400) { super(message); } }
const formats = 'wav,mp3,ogg,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,flac,aac';
function tool(binary: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { signal, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; let failed: unknown;
    child.stdout.on('data', bytes => { output += bytes.toString(); if (output.length > 100000) child.kill('SIGKILL'); });
    child.on('error', error => { failed = error; });
    child.on('close', code => code === 0 && !failed ? resolve(output) : reject(failed || new LectureAudioError('This audio could not be decoded. Use a supported audio file.')));
  });
}
async function probe(file: string, signal: AbortSignal) {
  const raw = await tool('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats, '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], signal);
  const result = JSON.parse(raw);
  if (!result.streams?.some((s: any) => s.codec_type === 'audio')) throw new LectureAudioError('Choose a file with an audio track.');
  const duration = Number(result.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}
export async function prepareLectureAudio(source: Readable, signal: AbortSignal): Promise<{ root: string; chunks: string[]; duration: number }> {
  const root = await mkdtemp(path.join(tmpdir(), 'zenos-lecture-'));
  const input = path.join(root, 'input.audio');
  try {
    let size = 0;
    const bounded = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > MAX_LECTURE_BYTES ? new LectureAudioError('Audio must be under 1 GB.', 413) : null, chunk); } });
    await pipeline(source, bounded, createWriteStream(input, { flags: 'wx', mode: 0o600 }), { signal });
    if (size < 1000) throw new LectureAudioError('That audio is too short or empty.');
    const conversion = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
    const duration = await probe(input, conversion);
    if (duration && duration > MAX_LECTURE_SECONDS + 0.25) throw new LectureAudioError('Audio must be 60 minutes or shorter.');
    await tool('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats, '-i', input, '-map', '0:a:0', '-vn', '-t', '3601', '-threads', '2', '-filter_threads', '1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', '240', '-reset_timestamps', '1', path.join(root, 'chunk-%03d.wav')], conversion);
    let chunks = (await readdir(root)).filter(name => /^chunk-\d+\.wav$/.test(name)).sort().map(name => path.join(root, name));
    if (!chunks.length || chunks.length > 16) throw new LectureAudioError('Audio must be 60 minutes or shorter.');
    const durations = await Promise.all(chunks.map(file => probe(file, conversion)));
    const total = durations.reduce<number>((sum, value) => sum + (value || 0), 0);
    if (total < 1 || total > MAX_LECTURE_SECONDS + 0.25) throw new LectureAudioError(total < 1 ? 'Choose at least one second of audio.' : 'Audio must be 60 minutes or shorter.');
    // Keep tiny format-padding tails valid without sending a sub-second STT request.
    if (chunks.length > 1 && (durations.at(-1) || 0) < 1) {
      const tail = chunks.pop()!; const previous = chunks.pop()!; const merged = path.join(root, 'merged.wav');
      await tool('ffmpeg', ['-nostdin', '-v', 'error', '-i', previous, '-i', tail, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-threads', '2', '-c:a', 'pcm_s16le', merged], conversion);
      await Promise.all([rm(tail), rm(previous)]); chunks.push(merged);
    }
    for (const file of chunks) if ((await stat(file)).size >= MAX_LECTURE_CHUNK_BYTES) throw new LectureAudioError('An audio chunk exceeded the processing limit.');
    await rm(input);
    return { root, chunks, duration: Math.min(total, MAX_LECTURE_SECONDS) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
export const readLectureChunk = (file: string) => readFile(file);

// Sweep abandoned directories from previous process runs; never follow symlinks.
export async function cleanAbandonedLectureAudio(now = Date.now()) {
  for (const name of await readdir(tmpdir())) {
    if (!/^zenos-lecture-[A-Za-z0-9]+$/.test(name)) continue;
    const root = path.join(tmpdir(), name);
    try { const info = await lstat(root); if (info.isDirectory() && !info.isSymbolicLink() && now - info.mtimeMs > 24 * 60 * 60 * 1000) await rm(root, { recursive: true, force: true }); } catch { /* Already cleaned by another process. */ }
  }
}
