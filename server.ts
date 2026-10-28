import {createWorkspaceContextReader} from './server/workspaces';
import { createTts } from './server/tts';
import { createWeeklyRecaps } from './server/weeklyRecaps';
import { createFocusRooms } from './server/focusRooms';
import { createChallenges } from './server/challenges';
import 'dotenv/config';
import express from 'express';
import { createGallery } from './server/gallery';
import { createArena } from './server/arena';
import { createSpaceEditor } from './server/space';
import { createSemanticSearch } from './server/search';
import { runDanteSearch, searchPromptData, searchSourceFooter } from './server/danteSearch';
import { createLectures } from './server/lectures';
import { createDanteMemoryReader } from './server/memory';
import { createGoogleTokens } from './server/google';
import { createBilling } from './server/billing';
import { createSnapHandler, snapImageBody } from './server/snap';
import { createDailyUsage } from './server/dailyUsage';
import { initServerMonitoring, captureServerError, captureExpressError } from './server/monitoring';
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
  await initServerMonitoring();
  const app = express();
  const billing = createBilling();
  const readMemory = createDanteMemoryReader();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billing.webhook);
  const daily = createDailyUsage({ isPro: billing.isPro, key: process.env.SUPABASE_SERVICE_ROLE_KEY, url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, limit: process.env.DANTE_DAILY_LIMIT });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const lectures = createLectures();
  app.post('/api/lectures/prepare', requireUser, rateLimit, lectures.prepare);
  app.post('/api/lectures/:id/transcribe/:index', requireUser, lectures.useJob, lectures.cachedChunk, rateLimit, daily.count('transcriptions'), lectures.chunk);
  app.post('/api/lectures/:id/analyze', requireUser, lectures.useJob, lectures.cachedResult, rateLimit, daily.count('messages'), lectures.analyze);
  app.delete('/api/lectures/:id', requireUser, lectures.useJob, lectures.cancel);
  app.post('/api/snap', requireUser, rateLimit, snapImageBody, createSnapHandler());
  app.use(express.json({ limit: '512kb' }));

  const weeklyRecaps=createWeeklyRecaps();
  weeklyRecaps.startWorker();
  app.get('/api/weekly-recaps',requireUser,weeklyRecaps.gate,weeklyRecaps.list);
  app.post('/api/weekly-recaps/settings',requireUser,weeklyRecaps.gate,weeklyRecaps.configure);
  app.post('/api/weekly-recaps/generate',requireUser,weeklyRecaps.gate,rateLimit,weeklyRecaps.generate);
  const tts=createTts({isPro:billing.isPro});
  app.post('/api/tts',requireUser,rateLimit,tts.handle);
  const focusRooms=createFocusRooms();
  app.get('/api/focus-rooms',requireUser,focusRooms.gate,focusRooms.list);
  app.post('/api/focus-rooms',requireUser,focusRooms.gate,rateLimit,focusRooms.create);
  app.post('/api/focus-rooms/:id/join',requireUser,focusRooms.gate,rateLimit,focusRooms.enter);
  app.post('/api/focus-rooms/:id/heartbeat',requireUser,focusRooms.gate,focusRooms.heartbeat);
  app.post('/api/focus-rooms/:id/leave',requireUser,focusRooms.gate,focusRooms.leave);
  app.post('/api/focus-rooms/:id/control',requireUser,focusRooms.gate,rateLimit,focusRooms.control);
  app.get('/api/focus-rooms/:id',requireUser,focusRooms.gate,focusRooms.read);
  const gallery=createGallery();
  const challenges=createChallenges();
  app.get('/api/challenges/mine',requireUser,gallery.signed,gallery.noCache,challenges.mine);
  app.get('/api/challenges/badges',requireUser,gallery.signed,gallery.noCache,challenges.badges);
  app.post('/api/challenges',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.admin,challenges.create);
  app.get('/api/challenges/:id/account',requireUser,gallery.signed,gallery.noCache,challenges.myDetail);
  app.post('/api/challenges/:id/submit',requireUser,gallery.signed,rateLimit,gallery.noCache,challenges.submit);
  app.post('/api/challenges/:id/vote',requireUser,gallery.signed,rateLimit,gallery.noCache,challenges.vote);
  app.get('/api/challenges/:id',gallery.noCache,challenges.detail);
  app.get('/api/challenges',gallery.noCache,challenges.list);
  app.get('/api/gallery/status',gallery.status);
  app.get('/api/gallery/account',requireUser,gallery.signed,gallery.noCache,gallery.account);
  app.get('/api/gallery/admin',requireUser,gallery.signed,gallery.noCache,gallery.admin,gallery.adminList);
  app.get('/api/gallery/admin/:id',requireUser,gallery.signed,gallery.noCache,gallery.admin,gallery.adminDetail);
  app.post('/api/gallery/admin/:id',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.admin,gallery.moderate);
  app.get('/api/gallery/mine/:id',requireUser,gallery.signed,gallery.noCache,gallery.mine);
  app.post('/api/gallery/publish',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.publish);
  app.post('/api/gallery/:id/withdraw',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.withdraw);
  app.post('/api/gallery/:id/report',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.report);
  app.post('/api/gallery/:id/remix',requireUser,gallery.signed,rateLimit,gallery.noCache,gallery.remix);
  app.get('/api/gallery/:id/tree',gallery.noCache,gallery.tree);
  app.get('/api/gallery/:id',gallery.noCache,gallery.detail);
  app.get('/api/gallery',gallery.noCache,gallery.list);
  const arena=createArena();
  app.get('/api/space/arena/status',arena.status);
  app.post('/api/space/arena/compare',requireUser,rateLimit,arena.prepare,daily.count('messages',2),arena.compare);
  const spaceEditor=createSpaceEditor();
  app.get('/api/space/status',spaceEditor.status);
  app.post('/api/space/pages/:id/edit',requireUser,rateLimit,spaceEditor.prepare,daily.count('messages'),spaceEditor.edit);

  const semanticSearch = createSemanticSearch();
  if(process.env.SEARCH_INDEX_WORKER!=='false')semanticSearch.startWorker(async owner => (await daily.reserve(owner,'messages')).allowed);
  app.get('/api/search/status', semanticSearch.status);
  app.get('/api/search/source', requireUser, rateLimit, semanticSearch.source);
  app.post('/api/search/index', requireUser, rateLimit, semanticSearch.prepareIndex, daily.count('messages'), semanticSearch.index);
  app.post('/api/search', requireUser, rateLimit, semanticSearch.prepareQuery, daily.count('messages'), semanticSearch.query);

  const google = createGoogleTokens();
  app.post('/api/google/connect', requireUser, rateLimit, google.connect);
  app.post('/api/google/token', requireUser, rateLimit, google.token);
  app.delete('/api/google/token', requireUser, google.disconnect);

  app.get('/api/billing/status', billing.status);
  app.get('/api/billing/account', requireUser, billing.account);
  app.post('/api/billing/checkout', requireUser, rateLimit, billing.checkout);
  app.post('/api/billing/portal', requireUser, rateLimit, billing.portal);

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
      tts: tts.enabled,
    });
  });

  app.get('/api/dante/usage', requireUser, daily.read);

  // Voice input: browser records audio, server sends it to a Whisper-style model
  app.post('/api/transcribe', requireUser, rateLimit, daily.count('transcriptions'), express.raw({ type: 'audio/*', limit: '15mb' }), transcribe);

  const readWorkspaceContext=createWorkspaceContextReader();
  app.post('/api/dante', requireUser, rateLimit, daily.count('messages'), async (req, res) => {
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

    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    let promptContext;
    let searchResult;
    try {
      const sharedContext=await readWorkspaceContext((req as any).userId,req.headers.authorization,context);
      promptContext = sharedContext || await readMemory((req as any).userId, req.headers.authorization, context);
      searchResult = sharedContext?{status:'unavailable',results:[],pending:0}:await runDanteSearch({userId:(req as any).userId,authorization:req.headers.authorization||'',question:history.at(-1)!.content,localSources:context?.localSearchSources,search:semanticSearch,config:llm,signal:abort.signal});
      // Never trust client-supplied retrieval results or tool status.
      promptContext = {...promptContext,search:searchPromptData(searchResult)};
    } catch {
      if(abort.signal.aborted)return;
      return res.status(503).json({ error: 'Dante could not load saved notes or memory. Check search setup and try again.' });
    }
    const full: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(promptContext) }, ...history];

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
      if(searchResult.status==='searched')res.write(`data: ${JSON.stringify({readOnly:true})}\n\n`);
    };

    try {
      for await (const text of streamChat(llm, full, abort.signal)) {
        startStream();
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      if (abort.signal.aborted) return;
      startStream();
      const footer=searchSourceFooter(searchResult.results);
      if(footer)res.write(`data: ${JSON.stringify({text:footer})}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      if (abort.signal.aborted) return;
      const message = err instanceof LLMError ? err.message : 'Unexpected error talking to the AI.';
      captureServerError(err);
      console.error('[dante] request failed');
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

  app.use(captureExpressError);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZEN_OS running → open http://localhost:${PORT} in your browser`);
    console.log(`  AI provider: ${llm.provider}${llm.model ? ` (${llm.model})` : ''}${describeConfigProblem(llm) ? ` — ${describeConfigProblem(llm)}` : ''}`);
    console.log(`  Voice transcription: ${STT_READY ? stt.model : 'off (browser speech only)'}`);
    console.log(`  Supabase: ${SUPABASE_CONFIGURED ? 'configured' : 'NOT configured (local mode only)'} · anonymous AI: ${ALLOW_ANONYMOUS}`);
  });
}

startServer().catch(error => {
  captureServerError(error);
  console.error(error);
  process.exitCode = 1;
});
