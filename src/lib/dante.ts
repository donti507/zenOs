import { ZenosState, DanteMessage } from '../types';
import { today, computeStreak } from './utils';

export type DanteAction = { action: string; data?: any; message?: string };

const JSON_BLOCK = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;

/** Removes <think>…</think> reasoning that some open models (Qwen, DeepSeek…) emit, including an unfinished block while streaming. */
export function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/** Text to show the user: no reasoning, no action JSON (also hides a half-streamed ```json block). */
export function visibleText(text: string) {
  return stripThinking(text)
    .replace(JSON_BLOCK, '')
    .replace(/```json[\s\S]*$/i, '')
    .trim();
}

/** Extracts actions; accepts {"actions":[…]}, a single {"action":…} or a bare array. */
export function parseActions(text: string): DanteAction[] {
  const out: DanteAction[] = [];
  for (const match of stripThinking(text).matchAll(JSON_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1]);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.actions) ? parsed.actions : [parsed];
      for (const a of list) if (a && typeof a.action === 'string') out.push(a);
    } catch {
      /* malformed JSON from the model — ignore */
    }
  }
  return out;
}

/** Plain text suitable for speech synthesis. */
export function toSpeech(text: string) {
  return visibleText(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildDanteContext(state: ZenosState, googleEvents: any[], userName: string, language: string, mode: 'chat' | 'voice' = 'chat') {
  const now = new Date();
  const todayStr = today();
  const tasks = state.tasks;
  const done = tasks.filter(t => t.status === 'done');
  return {
    mode,
    userName,
    language,
    now: {
      date: todayStr,
      time: now.toTimeString().slice(0, 5),
      weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    // Open tasks first so they survive the server-side cap
    tasks: [...tasks.filter(t => t.status !== 'done'), ...done.slice(-30)].map(t => ({
      id: t.id, title: t.title, status: t.status, date: t.date, cat: t.cat, progress: t.progress, note: t.note,
    })),
    meetings: (state.meetings || []).filter(m => m.status !== 'completed' || m.date >= todayStr).map(m => ({
      id: m.id, personName: m.personName, date: m.date, time: m.time, subject: m.subject, status: m.status,
    })),
    googleEvents: googleEvents.map(e => ({ summary: e.summary, start: e.start, end: e.end })),
    vault: state.vault.map(v => ({ name: v.name, url: v.url })),
    categories: state.categories.map(c => ({ id: c.id, label: c.label })),
    stats: {
      streak: computeStreak(state.completionLog),
      completionRate: Math.round((done.length / Math.max(1, tasks.length)) * 100),
      overdue: tasks.filter(t => t.status !== 'done' && t.date && t.date < todayStr).length,
      doneToday: state.completionLog.filter(d => d === todayStr).length,
    },
  };
}

export class DanteRequestError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/** POSTs to /api/dante and calls onText for each streamed chunk. Resolves with the full text. */
export async function streamDante(opts: {
  messages: Pick<DanteMessage, 'role' | 'content'>[];
  context: unknown;
  token: string | null;
  signal: AbortSignal;
  onText: (full: string) => void;
}): Promise<string> {
  const res = await fetch('/api/dante', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ messages: opts.messages, context: opts.context }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new DanteRequestError(body.error || `Dante is unavailable (HTTP ${res.status}).`, res.status);
  }
  if (!res.body) throw new DanteRequestError('Empty response from server.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const evt of events) {
      const line = evt.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { continue; }
      if (parsed.error) throw new DanteRequestError(parsed.error);
      if (parsed.text) {
        full += parsed.text;
        opts.onText(full);
      }
    }
  }
  return full;
}
