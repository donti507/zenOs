import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createGoogleTokens } from '../google';
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const env = { GOOGLE_CLIENT_ID: 'client-test', GOOGLE_CLIENT_SECRET: 'secret-test', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const fresh = { access_token: 'short-lived-access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events' };
let rows: Map<string, any>; let provider: ReturnType<typeof vi.fn>; let db: any; let server: Server; let base: string;
function database() {
  return { from: vi.fn(() => {
    let filters: [string, unknown][] = []; let operation = 'select'; let values: any;
    const run = () => {
      const found = [...rows.values()].find(row => filters.every(([k, v]) => row[k] === v));
      if (operation === 'upsert') { rows.set(values.user_id, { ...values }); return { error: null }; }
      if (operation === 'update' && found) Object.assign(found, values);
      if (operation === 'delete' && found) rows.delete(found.user_id);
      return { data: found ?? null, error: null };
    };
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      upsert: (value: any) => { values = value; operation = 'upsert'; return query; },
      update: (value: any) => { values = value; operation = 'update'; return query; },
      delete: () => { operation = 'delete'; return query; },
      maybeSingle: async () => run(), then: (resolve: any) => Promise.resolve(run()).then(resolve),
    };
    return query;
  }) };
}
async function start(overrides = {}) {
  const handlers = createGoogleTokens({ env: { ...env, ...overrides }, client: db, fetch: provider as any });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = req.headers['x-verified-user']; next(); });
  app.post('/connect', handlers.connect); app.post('/token', handlers.token); app.delete('/token', handlers.disconnect);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}
const request = (path: string, body: any = {}, id = a, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-verified-user': id }, body: JSON.stringify(body) });
beforeEach(() => { rows = new Map(); db = database(); provider = vi.fn().mockResolvedValue({ ok: true, json: async () => fresh }); });
afterEach(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }); });
it('stores verified Calendar consent only for the authenticated owner, never body IDs', async () => {
  await start();
  const response = await request('/connect', { user_id: b, provider_refresh_token: 'private-refresh' });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ access_token: fresh.access_token, expires_in: 3600 });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(rows.get(a).refresh_token).toBe('private-refresh'); expect(rows.has(b)).toBe(false);
  const [url, options] = provider.mock.calls[0]; expect(url).toBe('https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(options.body);
  expect(body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID); expect(body.get('client_secret')).toBe(env.GOOGLE_CLIENT_SECRET);
  expect(body.get('refresh_token')).toBe('private-refresh'); expect(options.redirect).toBe('error');
});
it('refreshes the stored credential and returns only a new short-lived token', async () => {
  rows.set(a, { user_id: a, refresh_token: 'stored-secret' }); rows.set(b, { user_id: b, refresh_token: 'other-secret' });
  await start();
  const response = await request('/token', { user_id: b, refresh_token: 'attacker-input' });
  const text = await response.text(); expect(response.status).toBe(200); expect(text).not.toContain('stored-secret'); expect(text).not.toContain('other-secret');
  expect(new URLSearchParams(provider.mock.calls[0][1].body).get('refresh_token')).toBe('stored-secret');
  provider.mockResolvedValue({ ok: true, json: async () => ({ ...fresh, access_token: 'next-access', refresh_token: 'rotated-secret' }) });
  expect((await request('/token')).status).toBe(200); expect(rows.get(a).refresh_token).toBe('rotated-secret');
});
it.each(['', 'anon:local'])('rejects unauthenticated/local identity %s on every route', async id => {
  await start();
  for (const [path, method] of [['/connect', 'POST'], ['/token', 'POST'], ['/token', 'DELETE']]) expect((await request(path, { user_id: a }, id, method)).status).toBe(401);
  expect(db.from).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
});
it('requires configuration for refresh, but allows private token deletion without Google credentials', async () => {
  rows.set(a, { user_id: a, refresh_token: 'secret' }); await start({ GOOGLE_CLIENT_SECRET: '' });
  expect((await request('/token')).status).toBe(503); expect(provider).not.toHaveBeenCalled();
  expect((await request('/token', { user_id: b }, a, 'DELETE')).status).toBe(204); expect(rows.has(a)).toBe(false);
});
it('does not overwrite stored offline access with a missing or non-Calendar credential', async () => {
  rows.set(a, { user_id: a, refresh_token: 'keep-me' }); await start();
  expect((await request('/connect')).status).toBe(400);
  provider.mockResolvedValue({ ok: true, json: async () => ({ ...fresh, scope: 'openid email' }) });
  expect((await request('/connect', { provider_refresh_token: 'wrong-scope' })).status).toBe(401);
  expect(rows.get(a).refresh_token).toBe('keep-me');
});
it('returns reconnect for missing/revoked access and removes only that stored token', async () => {
  await start(); expect((await request('/token')).status).toBe(404);
  rows.set(a, { user_id: a, refresh_token: 'revoked' }); rows.set(b, { user_id: b, refresh_token: 'other' });
  provider.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'PRIVATE_DETAIL' }) });
  const response = await request('/token'); expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ reconnect: true });
  expect(rows.has(a)).toBe(false); expect(rows.has(b)).toBe(true);
});
it('preserves tokens on transient errors and never echoes provider/credential details', async () => {
  rows.set(a, { user_id: a, refresh_token: 'stored-secret' }); await start();
  provider.mockRejectedValue(new Error('PRIVATE_SECRET_PROVIDER_DETAIL'));
  const response = await request('/token'); expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/PRIVATE|stored-secret|secret-test/); expect(rows.get(a).refresh_token).toBe('stored-secret');
});
it('cannot recreate a token deleted by another server while Google refresh is in flight', async () => {
  rows.set(a, { user_id: a, refresh_token: 'stored' }); await start();
  let finish!: (value: any) => void; provider.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = request('/token'); await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
  rows.delete(a); finish({ ok: true, json: async () => fresh });
  expect((await pending).status).toBe(409); expect(rows.has(a)).toBe(false);
});
it('serializes a concurrent credential upload and disconnect so the final state is disconnected', async () => {
  await start(); let finish!: (value: any) => void;
  provider.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const upload = request('/connect', { provider_refresh_token: 'new-secret' });
  await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
  const deletion = request('/token', {}, a, 'DELETE');
  finish({ ok: true, json: async () => fresh });
  expect((await upload).status).toBe(200); expect((await deletion).status).toBe(204); expect(rows.has(a)).toBe(false);
  expect((await request('/token')).status).toBe(404);
});
