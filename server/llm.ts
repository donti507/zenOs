/**
 * Provider-agnostic LLM streaming for Dante.
 *
 *  - "openai": any OpenAI-compatible /chat/completions endpoint (PSNC/PCSS, vLLM, Ollama,
 *              LM Studio, OpenRouter, Groq, OpenAI itself…). Configure with LLM_BASE_URL,
 *              LLM_API_KEY and LLM_MODEL.
 *  - "gemini": Google Gemini via @google/genai. Configure with GEMINI_API_KEY (+ GEMINI_MODEL).
 *
 * LLM_PROVIDER picks one explicitly; otherwise "openai" is used when LLM_BASE_URL is set,
 * then "gemini" when GEMINI_API_KEY is set.
 */
import { GoogleGenAI } from '@google/genai';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LLMConfig {
  provider: 'openai' | 'gemini' | 'none';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  extraHeaders: Record<string, string>;
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function loadLLMConfig(env = process.env): LLMConfig {
  const explicit = (env.LLM_PROVIDER || '').toLowerCase();
  const provider: LLMConfig['provider'] =
    explicit === 'openai' || explicit === 'psnc' ? 'openai'
    : explicit === 'gemini' ? 'gemini'
    : env.LLM_BASE_URL ? 'openai'
    : env.GEMINI_API_KEY ? 'gemini'
    : 'none';

  let extraHeaders: Record<string, string> = {};
  if (env.LLM_EXTRA_HEADERS) {
    try { extraHeaders = JSON.parse(env.LLM_EXTRA_HEADERS); }
    catch { console.warn('[dante] LLM_EXTRA_HEADERS is not valid JSON; ignoring it.'); }
  }

  return {
    provider,
    model: provider === 'gemini' ? env.GEMINI_MODEL || 'gemini-2.5-flash' : env.LLM_MODEL || '',
    baseUrl: (env.LLM_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: provider === 'gemini' ? env.GEMINI_API_KEY : env.LLM_API_KEY,
    temperature: num(env.LLM_TEMPERATURE, 0.6),
    maxTokens: num(env.LLM_MAX_TOKENS, 1200),
    timeoutMs: num(env.LLM_TIMEOUT_MS, 60000),
    extraHeaders,
  };
}

export function describeConfigProblem(cfg: LLMConfig): string | null {
  if (cfg.provider === 'none') return 'No AI provider configured. Set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL (e.g. PSNC) or GEMINI_API_KEY.';
  if (cfg.provider === 'openai' && !cfg.baseUrl) return 'LLM_BASE_URL is missing.';
  if (cfg.provider === 'openai' && !cfg.model) return 'LLM_MODEL is missing.';
  if (cfg.provider === 'gemini' && !cfg.apiKey) return 'GEMINI_API_KEY is missing.';
  return null;
}

export class LLMError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Yields text chunks. Throws LLMError with a readable message on failure. */
export async function* streamChat(cfg: LLMConfig, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  if (cfg.provider === 'openai') yield* streamOpenAICompatible(cfg, messages, signal);
  else if (cfg.provider === 'gemini') yield* streamGemini(cfg, messages, signal);
  else throw new LLMError(describeConfigProblem(cfg) || 'AI provider not configured', 503);
}

async function* streamOpenAICompatible(cfg: LLMConfig, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  // Accept either ".../v1" or a full ".../chat/completions" URL
  const url = /\/chat\/completions$/.test(cfg.baseUrl!) ? cfg.baseUrl! : `${cfg.baseUrl}/chat/completions`;

  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const combined = AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: combined,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        ...cfg.extraHeaders,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      }),
    });
  } catch (err: any) {
    if (signal.aborted) return;
    if (err?.name === 'TimeoutError') throw new LLMError('The AI server took too long to respond.', 504);
    throw new LLMError(`Could not reach the AI server (${err?.cause?.code || err?.message || 'network error'}).`, 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try { detail = JSON.parse(body)?.error?.message || JSON.parse(body)?.detail || detail; } catch { /* not JSON */ }
    const hint =
      res.status === 401 || res.status === 403 ? ' Check LLM_API_KEY.'
      : res.status === 404 ? ' Check LLM_BASE_URL and LLM_MODEL.'
      : res.status === 429 ? ' The AI provider is rate-limiting requests.'
      : '';
    throw new LLMError(`AI server returned ${res.status}.${hint}${detail ? ` (${detail})` : ''}`, res.status === 429 ? 429 : 502);
  }

  // Some servers ignore stream:true and return a single JSON body
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream')) {
    const data: any = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text) yield text;
    else throw new LLMError('AI server returned an empty or unrecognised response.');
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new LLMError(json.error.message || 'AI server stream error');
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text;
        if (typeof delta === 'string' && delta) yield delta;
      } catch (e) {
        if (e instanceof LLMError) throw e;
        // ignore keep-alives / partial lines
      }
    }
  }
}

async function* streamGemini(cfg: LLMConfig, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey! });
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  try {
    const stream = await ai.models.generateContentStream({
      model: cfg.model,
      contents,
      config: { systemInstruction: system, temperature: cfg.temperature, maxOutputTokens: cfg.maxTokens, abortSignal: signal },
    });
    for await (const chunk of stream) {
      if (signal.aborted) return;
      if (chunk.text) yield chunk.text;
    }
  } catch (err: any) {
    if (signal.aborted) return;
    throw new LLMError(`Gemini error: ${err?.message || 'unknown'}`);
  }
}
