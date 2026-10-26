// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DANTE_USAGE_CHANGED } from '../usageEvents';
import { streamDante } from '../dante';
afterEach(() => vi.unstubAllGlobals());
it.each(['success', 'quota', 'network'])('refreshes usage after a %s chat attempt without including request data', async mode => {
  const listener = vi.fn(); window.addEventListener(DANTE_USAGE_CHANGED, listener);
  const response = mode === 'quota' ? new Response(JSON.stringify({ error: 'Daily limit reached' }), { status: 429 }) : new Response('data: {"text":"Hello"}\n\ndata: [DONE]\n\n');
  vi.stubGlobal('fetch', mode === 'network' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(response));
  try {
    const call = streamDante({ messages: [{ role: 'user', content: 'PRIVATE_TASK' }], context: { note: 'PRIVATE_NOTE' }, token: null, signal: new AbortController().signal, onText: () => {} });
    if (mode === 'success') await expect(call).resolves.toBe('Hello'); else await expect(call).rejects.toThrow();
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as Event).type).toBe(DANTE_USAGE_CHANGED);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeUndefined();
  } finally { window.removeEventListener(DANTE_USAGE_CHANGED, listener); }
});
