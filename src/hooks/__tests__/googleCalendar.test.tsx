// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGoogleCalendar, GOOGLE_CONNECT_PENDING, type GoogleProviderSession } from '../useGoogleCalendar';
let root: Root; let host: HTMLDivElement; let ctx: ReturnType<typeof useGoogleCalendar>;
let options: { userId: string | null; isOffline: boolean; getAuthToken: () => Promise<string | null>; providerSession: GoogleProviderSession | null };
let request: ReturnType<typeof vi.fn>;
const response = (token = 'access-a') => ({ ok: true, status: 200, json: async () => ({ access_token: token, expires_in: 3600 }) });
function Consumer() { ctx = useGoogleCalendar(options); return null; }
const render = () => act(async () => root.render(<Consumer />));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  options = { userId: 'account-a', isOffline: false, getAuthToken: vi.fn().mockResolvedValue('supabase-jwt'), providerSession: null };
  request = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', request);
  localStorage.clear(); sessionStorage.clear(); host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('restores Calendar after reload without a provider access token and caches access only in memory', async () => {
  await render(); expect(ctx.googleConnected).toBe(true); expect(ctx.accessToken).toBe('access-a');
  expect(request).toHaveBeenCalledWith('/api/google/token', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer supabase-jwt' }, cache: 'no-store' }));
  expect(await ctx.getGoogleAccessToken()).toBe('access-a'); expect(request).toHaveBeenCalledOnce(); expect(localStorage.length).toBe(0);
});
it('refreshes expired tokens once for concurrent callers and on browser focus', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T10:00:00Z')); await render();
  vi.setSystemTime(new Date('2026-10-27T11:00:00Z')); request.mockResolvedValue(response('renewed'));
  let values: string[] = [];
  await act(async () => { values = await Promise.all([ctx.getGoogleAccessToken(), ctx.getGoogleAccessToken()]); });
  expect(values).toEqual(['renewed', 'renewed']); expect(request).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z')); request.mockResolvedValue(response('focus-token'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(ctx.accessToken).toBe('focus-token'); expect(request).toHaveBeenCalledTimes(3);
});
it('uploads explicit provider refresh consent with a verified JWT and handles StrictMode startup', async () => {
  sessionStorage.setItem(GOOGLE_CONNECT_PENDING, 'true');
  options.providerSession = { userId: 'account-a', refreshToken: 'provider-private', authToken: 'verified-jwt' };
  await act(async () => root.render(<StrictMode><Consumer /></StrictMode>));
  expect(ctx.googleConnected).toBe(true);
  expect(request).toHaveBeenCalledWith('/api/google/connect', expect.objectContaining({ headers: { Authorization: 'Bearer verified-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_refresh_token: 'provider-private' }) }));
  expect(sessionStorage.getItem(GOOGLE_CONNECT_PENDING)).toBeNull(); expect(localStorage.length).toBe(0);
});
it('stops serving cached tokens after revoked consent and asks for reconnection', async () => {
  await render(); request.mockResolvedValue({ ok: false, status: 401, json: async () => ({ reconnect: true }) });
  await act(async () => { await expect(ctx.getGoogleAccessToken(true)).rejects.toThrow('Reconnect'); });
  expect(ctx.accessToken).toBeNull(); expect(ctx.googleConnected).toBe(false); expect(ctx.googleCalendarError).toContain('Reconnect');
});
it('treats missing connections as disconnected rather than an application error', async () => {
  request.mockResolvedValue({ ok: false, status: 404, json: async () => ({ reconnect: true }) });
  await render(); expect(ctx.googleConnected).toBe(false); expect(ctx.googleCalendarError).toBeNull();
});
it('disconnects remotely and ignores an in-flight refresh response', async () => {
  await render(); let finish!: (value: any) => void;
  request.mockImplementation((path: string, init: any) => init.method === 'DELETE' ? Promise.resolve({ ok: true, status: 204 }) : new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<string>;
  await act(async () => { pending = ctx.getGoogleAccessToken(true); });
  await act(async () => ctx.disconnectGoogleCalendar()); expect(ctx.googleConnected).toBe(false); expect(ctx.accessToken).toBeNull();
  await act(async () => { finish(response('stale')); await expect(pending).rejects.toThrow('session changed'); });
  expect(ctx.googleConnected).toBe(false);
  expect(request).toHaveBeenCalledWith('/api/google/token', { method: 'DELETE', headers: { Authorization: 'Bearer supabase-jwt' }, cache: 'no-store' });
});
it('never leaks a token across account switches or into local mode', async () => {
  await render(); options = { ...options, userId: 'local-user', isOffline: true }; await render();
  expect(ctx.accessToken).toBeNull(); expect(ctx.googleConnected).toBe(false); expect(request).toHaveBeenCalledOnce();
  await expect(ctx.getGoogleAccessToken()).rejects.toThrow('signed-in account');
  await act(async () => ctx.disconnectGoogleCalendar()); expect(request).toHaveBeenCalledOnce();
});
it('preserves a retry path when disconnect fails', async () => {
  await render(); request.mockRejectedValue(new Error('network'));
  await act(async () => { await expect(ctx.disconnectGoogleCalendar()).rejects.toThrow('Could not disconnect'); });
  expect(ctx.googleConnected).toBe(true); expect(ctx.googleCalendarError).toContain('Could not disconnect');
  request.mockResolvedValue({ ok: true, status: 204 }); await act(async () => ctx.disconnectGoogleCalendar());
  expect(ctx.googleConnected).toBe(false);
});

it('recovers missing access automatically on focus after a transient server failure', async () => {
  request.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  await render(); expect(ctx.accessToken).toBeNull();
  request.mockResolvedValue(response('recovered'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(ctx.accessToken).toBe('recovered'); expect(ctx.googleConnected).toBe(true);
});

it('does not upload the same provider grant twice for repeated Supabase session callbacks', async () => {
  options.providerSession = { userId: 'account-a', refreshToken: 'provider-private', authToken: 'verified-jwt' };
  await render(); expect(request).toHaveBeenCalledOnce();
  options = { ...options, providerSession: { ...options.providerSession, authToken: 'new-supabase-jwt' } };
  await render(); expect(request).toHaveBeenCalledOnce(); expect(ctx.googleConnected).toBe(true);
});
