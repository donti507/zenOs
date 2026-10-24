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

export const stt = {
  model: process.env.STT_MODEL || '',
  baseUrl: (process.env.STT_BASE_URL || process.env.LLM_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.STT_API_KEY || process.env.LLM_API_KEY || '',
};
export const STT_READY = !!(stt.model && stt.baseUrl);

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

export async function transcribe(req: Request, res: Response) {
  if (!STT_READY) return res.status(503).json({ error: 'Voice transcription is not set up on the server (STT_MODEL is missing).' });
  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'No audio received. Try speaking a little longer.' });

  const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${EXT[type] || 'webm'}`);
  form.append('model', stt.model);
  const lang = String(req.query.lang || '').split('-')[0];
  if (/^[a-z]{2}$/.test(lang)) form.append('language', lang);

  try {
    const r = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: stt.apiKey ? { Authorization: `Bearer ${stt.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.text();
    if (!r.ok) {
      let detail = body.slice(0, 200);
      try { detail = JSON.parse(body)?.error?.message || detail; } catch { /* not JSON */ }
      return res.status(502).json({ error: `Transcription failed (${r.status}). ${detail}` });
    }
    let text = body;
    try { text = JSON.parse(body).text ?? ''; } catch { /* plain-text response */ }
    res.json({ text: String(text).trim() });
  } catch (err: any) {
    res.status(502).json({ error: err?.name === 'TimeoutError' ? 'Transcription took too long.' : `Could not reach the transcription server (${err?.message}).` });
  }
}
