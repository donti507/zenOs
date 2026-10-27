// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
import { notifyDanteUsage } from '../../lib/usageEvents';
vi.mock('../../lib/supabase', () => ({
  SUPABASE_CONFIGURED: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'real-a' }, access_token: 'test-token' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => {
      const result = { data: table === 'categories' ? [{ id: 'work', label: 'Work' }] : [], error: null };
      const chain: any = { select: () => chain, order: () => chain, limit: () => chain, then: (resolve: any) => Promise.resolve(result).then(resolve) };
      return chain;
    },
  },
}));
let ctx: ReturnType<typeof useZenos>;
function Consumer() { ctx = useZenos(); return null; }
let host: HTMLDivElement; let root: Root;
const usage = (remaining = 20, date = '2026-10-26', resetsAt = '2026-10-27T00:00:00.000Z') => ({ enabled: true, date, resetsAt, limit: 20, messages: 20 - remaining, transcriptions: 0, messagesRemaining: remaining, transcriptionsRemaining: 20 });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => usage() });
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mount = () => act(async () => root.render(<ZenosProvider><Consumer /></ZenosProvider>));
it('fetches private usage through the context and refreshes after chat/voice signals and focus', async () => {
  await mount();
  expect(ctx.danteUsage).toMatchObject({ messagesRemaining: 20 });
  expect(fetchMock).toHaveBeenCalledWith('/api/dante/usage', { headers: { Authorization: 'Bearer test-token' }, cache: 'no-store' });
  fetchMock.mockResolvedValue({ ok: true, json: async () => usage(17) });
  await act(async () => notifyDanteUsage());
  expect(ctx.danteUsage).toMatchObject({ messagesRemaining: 17 });
  fetchMock.mockResolvedValue({ ok: true, json: async () => usage(16) });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(ctx.danteUsage).toMatchObject({ messagesRemaining: 16 });
});
it('refreshes across midnight UTC', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T23:59:59Z'));
  let usageCalls = 0;
  fetchMock.mockImplementation(async (path: string) => ({ ok: true, json: async () => path !== '/api/dante/usage' ? { enabled: false } : ++usageCalls === 1 ? usage(0) : usage(20, '2026-10-27', '2026-10-28T00:00:00Z') }));
  await mount();
  expect(ctx.danteUsage).toMatchObject({ messagesRemaining: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(1200));
  expect(ctx.danteUsage).toMatchObject({ messagesRemaining: 20, date: '2026-10-27' });
});
it('does not expose a late response from a previous account when switching to local mode', async () => {
  let resolve!: (response: any) => void;
  fetchMock.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount();
  await act(async () => ctx.loginOffline());
  expect(ctx.danteUsage).toEqual({ enabled: false });
  await act(async () => resolve({ ok: true, json: async () => usage(2) }));
  expect(ctx.danteUsage).toEqual({ enabled: false });
});
