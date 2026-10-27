import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Request, RequestHandler } from 'express';
import { prepareLectureAudio, readLectureChunk, LectureAudioError, cleanAbandonedLectureAudio } from './lectureAudio';
import { transcribeAudio, STT_READY } from './stt';
import { analyzeLecture, type LectureModel } from './lectureAnalysis';
import { describeConfigProblem, loadLLMConfig } from './llm';
import { MAX_LECTURE_BYTES, MAX_LECTURE_CHUNK_BYTES, MAX_TRANSCRIPT_CHARS, type Lecture, type LectureNotes } from '../shared/lectures';
type Prepared = Awaited<ReturnType<typeof prepareLectureAudio>>;
type Job = Prepared & { id: string; owner: string; touched: number; controller: AbortController; text: Map<number,string>; notes: Map<string,string>; transcribing: Set<number>; result?: Lecture; analyzing: boolean };
export function createLectures(options: { prepare?: typeof prepareLectureAudio; transcribe?: typeof transcribeAudio; analyze?: typeof analyzeLecture; model?: LectureModel; ready?: boolean; ttlMs?: number } = {}) {
  void cleanAbandonedLectureAudio().catch(() => {});
  const jobs = new Map<string, Job>(); const preparing = new Set<string>(); let running = 0;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const owner = (req: Request) => typeof (req as any).userId === 'string' ? (req as any).userId as string : null;
  const drop = async (job: Job) => { job.controller.abort(); jobs.delete(job.id); await rm(job.root, { recursive: true, force: true }); };
  const timer = setInterval(() => { for (const job of jobs.values()) if (Date.now() - job.touched > ttl && !job.analyzing && !job.transcribing.size) void drop(job).catch(() => {}); }, 60000); timer.unref();
  const prepare: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = owner(req); if (!id) return res.status(401).json({ error: 'Sign in to process a lecture.' });
    if (!(options.ready ?? (STT_READY && !describeConfigProblem(loadLLMConfig())))) return res.status(503).json({ error: 'Lecture processing needs transcription and an AI provider configured on the server.' });
    if (!/^(audio\/|video\/(webm|mp4)|application\/octet-stream)/i.test(String(req.headers['content-type'] || ''))) return res.status(415).json({ error: 'Choose an audio file.' });
    if (Number(req.headers['content-length']) > MAX_LECTURE_BYTES) return res.status(413).json({ error: 'Audio must be under 1 GB.' });
    if (preparing.has(id) || [...jobs.values()].some(job => job.owner === id)) return res.status(409).json({ error: 'Finish or cancel your current lecture first.' });
    if (running >= 2 || jobs.size >= 8) return res.status(503).json({ error: 'Lecture processing is busy. Please try again shortly.' });
    preparing.add(id); running++;
    const abort = new AbortController();
    const closed = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', closed);
    let prepared: Prepared | undefined;
    try {
      prepared = await (options.prepare ?? prepareLectureAudio)(req, abort.signal);
      if (abort.signal.aborted) return;
      if(jobs.size>=8)throw new LectureAudioError('Lecture processing is busy. Please try again shortly.',503);
      const job: Job = { ...prepared, id: randomUUID(), owner: id, touched: Date.now(), controller: new AbortController(), text: new Map(), notes: new Map(), transcribing: new Set(), analyzing: false };
      jobs.set(job.id, job); prepared = undefined;
      res.json({ id: job.id, chunks: job.chunks.length, durationSeconds: job.duration });
    } catch (error) {
      if (!abort.signal.aborted) res.status(error instanceof LectureAudioError ? error.status : 400).json({ error: error instanceof LectureAudioError ? error.message : 'We could not read this audio. Use a supported file up to 60 minutes.' });
    } finally { if (prepared) await rm(prepared.root, { recursive: true, force: true }); running--; preparing.delete(id); res.off('close', closed); }
  };
  const useJob: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const job = jobs.get(String(req.params.id));
    if (!job || job.owner !== owner(req) || Date.now() - job.touched > ttl) {
      if (job && job.owner === owner(req) && !job.analyzing && !job.transcribing.size) void drop(job).catch(() => {});
      return res.status(404).json({ error: 'This processing session expired. Choose the audio again.' });
    }
    job.touched = Date.now(); (req as any).lectureJob = job; next();
  };
  const cachedChunk: RequestHandler = (req, res, next) => {
    const job: Job = (req as any).lectureJob; const index = Number(req.params.index);
    if (!/^\d+$/.test(String(req.params.index)) || !Number.isInteger(index) || index < 0 || index >= job.chunks.length) return res.status(400).json({ error: 'Invalid audio chunk.' });
    if (job.text.has(index)) return res.json({ text: job.text.get(index) });
    if (job.transcribing.size) return res.status(409).json({ error: 'A transcription is still in progress. Please retry shortly.' });
    next();
  };
  const chunk: RequestHandler = async (req, res) => {
    const job: Job = (req as any).lectureJob; const index = Number(req.params.index);
    if(job.text.has(index))return res.json({text:job.text.get(index)});
    if(job.transcribing.size)return res.status(409).json({error:'A transcription is still in progress.'});
    job.transcribing.add(index);
    const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', close);
    try {
      const audio = await readLectureChunk(job.chunks[index]);
      if(audio.length>=MAX_LECTURE_CHUNK_BYTES)throw new Error('Audio chunk limit exceeded');
      const text = await (options.transcribe ?? transcribeAudio)(audio, 'audio/wav', String(req.query.lang || ''), AbortSignal.any([abort.signal, job.controller.signal]));
      if (job.controller.signal.aborted || abort.signal.aborted) return;
      if (text.length + [...job.text.values()].reduce((n,t) => n+t.length,0) > MAX_TRANSCRIPT_CHARS) return res.status(422).json({ error: 'The lecture transcript is too large to analyze.' });
      job.text.set(index, text); res.json({ text });
    } catch { if (!res.destroyed) res.status(502).json({ error: 'Could not transcribe this section. Retry to continue from the completed sections.' }); }
    finally { job.transcribing.delete(index); job.touched = Date.now(); res.off('close', close); }
  };
  const write = (res: Parameters<RequestHandler>[1], value: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
  const cachedResult: RequestHandler = (req, res, next) => {
    const job: Job = (req as any).lectureJob;
    if (job.result) { res.type('application/x-ndjson'); write(res, { type: 'result', lecture: job.result }); return res.end(); }
    if (job.text.size !== job.chunks.length) return res.status(409).json({ error: 'Transcribe all audio sections first.' });
    if (![...job.text.values()].some(text=>text.trim())) return res.status(422).json({error:'No speech was found. Choose audio with clear speech.'});
    if (job.analyzing || running >= 2) return res.status(409).json({ error: 'Analysis is busy. Please retry shortly.' });
    next();
  };
  const analyze: RequestHandler = async (req, res) => {
    const job: Job = (req as any).lectureJob;
    if (job.analyzing || running >= 2) return res.status(409).json({ error: 'Analysis is busy. Please retry shortly.' });
    job.analyzing = true; running++;
    const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', close);
    res.type('application/x-ndjson'); res.setHeader('X-Accel-Buffering', 'no');
    const heartbeat = setInterval(() => write(res, { type: 'heartbeat' }), 15000);
    try {
      const transcript = [...job.text.entries()].sort((a,b) => a[0]-b[0]).map(([,text]) => text).join('\n\n').trim();
      const notes: LectureNotes = await (options.analyze ?? analyzeLecture)(transcript, AbortSignal.any([abort.signal, job.controller.signal]), (completed,total,message) => write(res, { type: 'progress', completed,total,message }), options.model, job.notes);
      if (abort.signal.aborted || job.controller.signal.aborted) return;
      job.result = { ...notes, id: job.id, title: 'Untitled lecture', durationSeconds: job.duration, transcript, createdAt: new Date().toISOString() };
      write(res, { type: 'result', lecture: job.result });
    } catch { write(res, { type: 'error', error: 'Could not create study notes. Retry to reuse your completed transcriptions.' }); }
    finally { clearInterval(heartbeat); running--; job.analyzing = false; job.touched = Date.now(); res.off('close', close); if (!res.destroyed) res.end(); }
  };
  const cancel: RequestHandler = async (req, res) => { try { await drop((req as any).lectureJob); res.status(204).end(); } catch { res.status(503).json({error:'Could not clean up this processing session. Temporary audio will expire automatically.'}); } };
  const close = async () => { clearInterval(timer); await Promise.all([...jobs.values()].map(drop)); };
  return { prepare, useJob, cachedChunk, chunk, cachedResult, analyze, cancel, close };
}
