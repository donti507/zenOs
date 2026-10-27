// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
vi.mock('../../lib/supabase', () => ({
  SUPABASE_CONFIGURED: true,
  supabase: {
    realtime: { setAuth: async () => {} },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: async () => 'ok',
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'real-a' }, access_token: 'verified-token' } } }),
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
let ctx: ReturnType<typeof useZenos>; let host: HTMLDivElement; let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
function Consumer() { ctx = useZenos(); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear();
  fetchMock = vi.fn().mockImplementation(async (path: string) => ({ ok: true, json: async () => path === '/api/billing/account' ? { enabled: true, plan: 'pro', hasCustomer: true } : { enabled: false } }));
  vi.stubGlobal('fetch', fetchMock); host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<ZenosProvider><Consumer /></ZenosProvider>));
it('loads account billing with the bearer token and refreshes plan on focus', async () => {
  await mount(); expect(ctx.billing).toMatchObject({ enabled: true, plan: 'pro' });
  expect(fetchMock).toHaveBeenCalledWith('/api/billing/account', { headers: { Authorization: 'Bearer verified-token' }, cache: 'no-store' });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enabled: true, plan: 'free' }) });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(ctx.billing).toMatchObject({ plan: 'free' });
});
it('does not expose a late private plan after switching to local mode', async () => {
  await mount(); let finish!: (value: any) => void;
  fetchMock.mockImplementation((path: string) => path === '/api/billing/account' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ enabled: false }) }));
  let pending!: Promise<void>;
  await act(async () => { pending = ctx.refreshBilling(); });
  await act(async () => ctx.loginOffline());
  await act(async () => { finish({ ok: true, json: async () => ({ enabled: true, plan: 'pro' }) }); await pending; });
  expect(ctx.billing?.plan).not.toBe('pro');
  await expect(ctx.startBilling('checkout')).rejects.toThrow('Sign in');
});
it('hides billing on failed status and sends no client identity or redirect values', async () => {
  await mount(); fetchMock.mockResolvedValue({ ok: false });
  await act(async () => ctx.refreshBilling()); expect(ctx.billing).toBeNull();
  await expect(ctx.startBilling('checkout')).rejects.toThrow('Could not open billing');
  expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout', { method: 'POST', headers: { Authorization: 'Bearer verified-token' } });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://evil.test/payment' }) });
  await expect(ctx.startBilling('portal')).rejects.toThrow('Invalid billing destination');
});
