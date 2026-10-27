/**
 * Server-side speech-to-text for Dante's microphone.
 * Forwards recorded audio to an OpenAI-compatible /audio/transcriptions endpoint
 * (Whisper-style). Works in every browser, unlike the Web Speech API.
 *
 * STT_MODEL     model name, e.g. "whisper-large-v3" (required to enable this)
 * STT_BASE_URL  defaults to LLM_BASE_URL
 * STT_API_KEY   defaults to LLM_API_KEY
 */
import type { Request, Response } from 'express';
import { captureServerError } from './monitoring';

export const stt = {
  model: process.env.STT_MODEL || '',
  baseUrl: (process.env.STT_BASE_URL || process.env.LLM_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.STT_API_KEY || process.env.LLM_API_KEY || '',
};
export const STT_READY = !!(stt.model && stt.baseUrl);

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

export async function transcribeAudio(audio: Buffer, type = 'audio/webm', language = '', signal?: AbortSignal, config = stt, request: typeof fetch = fetch): Promise<string> {
  if (!config.model || !config.baseUrl) throw new Error('Voice transcription is not configured.');
  if (!Buffer.isBuffer(audio) || audio.length < 1000) throw new Error('No audio received. Try speaking a little longer.');
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${EXT[type] || 'webm'}`);
  form.append('model', config.model);
  const lang = language.split('-')[0];
  if (/^[a-z]{2}$/.test(lang)) form.append('language', lang);
  const timeout = AbortSignal.timeout(60000);
  const r = await request(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST', headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!r.ok) throw new Error(r.status === 429 ? 'The transcription provider is busy. Please try again.' : 'The transcription provider could not process this audio.');
  const body = await r.text();
  let text = body;
  try { text = JSON.parse(body).text ?? ''; } catch { /* plain-text response */ }
  if (typeof text !== 'string' || text.length > 50000) throw new Error('Invalid transcription result.');
  return text.trim();
}

export async function transcribe(req: Request, res: Response) {
  if (!STT_READY) return res.status(503).json({ error: 'Voice transcription is not set up on the server (STT_MODEL is missing).' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'No audio received. Try speaking a little longer.' });
  const abort = new AbortController();
  const close = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', close);
  try {
    const text = await transcribeAudio(req.body, String(req.headers['content-type'] || 'audio/webm').split(';')[0], String(req.query.lang || ''), abort.signal);
    res.json({ text });
  } catch (err: any) {
    if (abort.signal.aborted) return;
    captureServerError(new Error('Transcription failed'));
    res.status(502).json({ error: err?.name === 'TimeoutError' ? 'Transcription took too long.' : 'Could not transcribe the audio. Please try again.' });
  } finally { res.off('close', close); }
}
