// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
const mocks = vi.hoisted(() => ({ id: 'real-account-a', rpc: vi.fn(), signOut: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  SUPABASE_CONFIGURED: true,
  supabase: {
    realtime: { setAuth: async () => {} },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
    removeChannel: async () => 'ok',
    auth: {
      getSession: async () => ({ data: { session: { user: { id: mocks.id }, access_token: 'session' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: mocks.signOut,
    },
    from: (table: string) => {
      const result = { data: table === 'categories' ? [{ id: 'cloud-category', label: 'Work' }] : [], error: null };
      const chain: any = { select: () => chain, order: () => chain, limit: () => chain, then: (resolve: any) => Promise.resolve(result).then(resolve) };
      return chain;
    },
    rpc: mocks.rpc,
  },
}));
let ctx: ReturnType<typeof useZenos>;
function Consumer() { ctx = useZenos(); return null; }
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('zenos_tasks', '[{"id":"local-task","title":"Local task"}]');
  mocks.id = 'real-account-a';
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(<ZenosProvider><Consumer /></ZenosProvider>)); }
it('offers import on an existing real session and imports through the context', async () => {
  await mount();
  expect(ctx.localImportOpen).toBe(true);
  await act(async () => ctx.importLocalWorkspace());
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(ctx.localImportOpen).toBe(false);
  expect(localStorage.getItem('zenos_tasks')).toBeNull();
});
it('remembers decline across sign-ins only for that account', async () => {
  await mount();
  await act(async () => ctx.declineLocalWorkspace());
  expect(ctx.localImportOpen).toBe(false);
  expect(localStorage.getItem('zenos_tasks')).toContain('Local task');
  await act(async () => root.unmount()); root = createRoot(host);
  await mount();
  expect(ctx.localImportOpen).toBe(false);
  await act(async () => root.unmount()); root = createRoot(host); mocks.id = 'real-account-b';
  await mount();
  expect(ctx.localImportOpen).toBe(true);
});
it('keeps the dialog and local data on RPC failure', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'Connection lost' } });
  await mount();
  await act(async () => ctx.importLocalWorkspace());
  expect(ctx.localImportOpen).toBe(true);
  expect(ctx.localImportError).toContain('Connection lost');
  expect(localStorage.getItem('zenos_tasks')).toContain('Local task');
});
it('does not offer cloud import to a local/demo user', async () => {
  await mount();
  await act(async () => ctx.loginOffline());
  expect(ctx.isOffline).toBe(true);
  expect(ctx.localImportOpen).toBe(false);
  await act(async () => ctx.importLocalWorkspace());
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(ctx.state.tasks[0].title).toBe('Local task');
});
