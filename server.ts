import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { loadLLMConfig, describeConfigProblem, streamChat, LLMError, type ChatMessage } from './server/llm';
import { buildSystemPrompt } from './server/prompt';
import { requireUser, rateLimit, ALLOW_ANONYMOUS, SUPABASE_CONFIGURED } from './server/auth';
import { transcribe, STT_READY, stt } from './server/stt';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const llm = loadLLMConfig();
const HISTORY_LIMIT = 12;

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Lets the UI show which model is connected and why AI might be unavailable
  app.get('/api/dante/status', (_req, res) => {
    const problem = describeConfigProblem(llm);
    res.json({
      ready: !problem,
      provider: llm.provider,
      model: llm.model || null,
      problem,
      authRequired: !ALLOW_ANONYMOUS,
      stt: STT_READY,
    });
  });

  // Voice input: browser records audio, server sends it to a Whisper-style model
  app.post('/api/transcribe', requireUser, rateLimit, express.raw({ type: 'audio/*', limit: '15mb' }), transcribe);

  app.post('/api/dante', requireUser, rateLimit, async (req, res) => {
    const problem = describeConfigProblem(llm);
    if (problem) return res.status(503).json({ error: problem });

    const { messages, context } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array.' });
    }

    // Sanitise history: only user/assistant roles, capped length, no client-supplied system prompts
    const history: ChatMessage[] = messages
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-HISTORY_LIMIT)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be from the user.' });
    }
    // Most chat servers require the first non-system message to be from the user
    while (history.length && history[0].role !== 'user') history.shift();

    const full: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(context) }, ...history];

    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    let started = false;
    const startStream = () => {
      if (started) return;
      started = true;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx, Azure)
      res.flushHeaders();
    };

    try {
      for await (const text of streamChat(llm, full, abort.signal)) {
        startStream();
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      if (abort.signal.aborted) return;
      startStream();
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      if (abort.signal.aborted) return;
      const message = err instanceof LLMError ? err.message : 'Unexpected error talking to the AI.';
      console.error('[dante]', err);
      if (!started) {
        // Headers not sent yet → normal JSON error with a real status code
        res.status(err instanceof LLMError ? err.status : 500).json({ error: message });
      } else {
        // Mid-stream failure → tell the client inside the stream
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Inject public runtime config so the same build works in every environment
    const runtimeConfig = {
      supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    };
    const indexHtml = fs
      .readFileSync(path.join(distPath, 'index.html'), 'utf8')
      .replace('<head>', `<head><script>window.__ZENOS_CONFIG__=${JSON.stringify(runtimeConfig).replace(/</g, '\\u003c')}</script>`);

    app.use(express.static(distPath, { index: false, maxAge: '1y', immutable: true }));
    app.get('*', (req, res) => {
      // A missing JS/CSS file must be a 404, not index.html (avoids "MIME type text/html" errors after a deploy)
      if (req.path.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(req.path)) return res.status(404).end();
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(indexHtml);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZEN_OS listening on http://0.0.0.0:${PORT}`);
    console.log(`  AI provider: ${llm.provider}${llm.model ? ` (${llm.model})` : ''}${describeConfigProblem(llm) ? ` — ${describeConfigProblem(llm)}` : ''}`);
    console.log(`  Voice transcription: ${STT_READY ? stt.model : 'off (browser speech only)'}`);
    console.log(`  Supabase: ${SUPABASE_CONFIGURED ? 'configured' : 'NOT configured (local mode only)'} · anonymous AI: ${ALLOW_ANONYMOUS}`);
  });
}

startServer();
