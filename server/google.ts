import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];
export function createGoogleTokens(options: { env?: NodeJS.ProcessEnv; client?: SupabaseClient; fetch?: typeof fetch } = {}) {
  const env = options.env ?? process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const storageReady = !!url?.trim() && !!env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const refreshReady = storageReady && !!env.GOOGLE_CLIENT_ID?.trim() && !!env.GOOGLE_CLIENT_SECRET?.trim();
  let client = options.client;
  const db = () => client ??= createClient(url!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const request = options.fetch ?? fetch;
  const user = (req: Parameters<RequestHandler>[0]) => {
    const id = (req as any).userId;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  };
  const failure = (res: Parameters<RequestHandler>[1]) => res.status(503).json({ error: 'Google Calendar is temporarily unavailable. Please try again.' });
  class ConsentError extends Error {}
  async function exchange(refreshToken: string) {
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }).toString(),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    // Never echo/log upstream bodies: they can contain provider tokens or secrets.
    if (!response.ok) {
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        if (body.error === 'invalid_grant') throw new ConsentError();
      }
      throw new Error('Google token exchange unavailable');
    }
    const body = await response.json();
    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error('Invalid token response');
    if (typeof body.scope !== 'string' || !body.scope.split(' ').some((scope: string) => CALENDAR_SCOPES.includes(scope))) throw new ConsentError();
    return { accessToken: body.access_token as string, expiresIn: body.expires_in as number, rotatedToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : refreshToken };
  }
  const connect: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to connect Google Calendar.' });
    if (!refreshReady) return failure(res);
    const token = req.body?.provider_refresh_token;
    if (typeof token !== 'string' || !token.trim() || token.length > 16384) return res.status(400).json({ error: 'Connect Google Calendar again to grant offline access.' });
    try {
      const fresh = await exchange(token);
      const { error } = await db().from('google_tokens').upsert({ user_id: userId, refresh_token: fresh.rotatedToken, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw new Error('Token storage unavailable');
      res.json({ access_token: fresh.accessToken, expires_in: fresh.expiresIn });
    } catch (error) {
      if (error instanceof ConsentError) return res.status(401).json({ error: 'Reconnect Google Calendar and allow Calendar access.', reconnect: true });
      failure(res);
    }
  };
  const token: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to use Google Calendar.' });
    if (!refreshReady) return failure(res);
    let stored: string | undefined;
    try {
      const { data, error } = await db().from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
      if (error) throw new Error('Token storage unavailable');
      if (!data) return res.status(404).json({ error: 'Connect Google Calendar to sync your events.', reconnect: true });
      stored = data.refresh_token;
      const fresh = await exchange(stored!);
      // Conditional UPDATE (never UPSERT) cannot recreate a disconnected account or
      // overwrite a newly connected token if disconnect/reconnect races a refresh.
      const saved = await db().from('google_tokens').update({ refresh_token: fresh.rotatedToken, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('refresh_token', stored).select('user_id').maybeSingle();
      if (saved.error) throw new Error('Token storage unavailable');
      if (!saved.data) return res.status(409).json({ error: 'Calendar connection changed. Please try again.' });
      res.json({ access_token: fresh.accessToken, expires_in: fresh.expiresIn });
    } catch (error) {
      if (error instanceof ConsentError) {
        // Only remove the invalid token we read, preserving a concurrent reconnect.
        const deleted = await db().from('google_tokens').delete().eq('user_id', userId).eq('refresh_token', stored);
        if (deleted.error) return failure(res);
        return res.status(401).json({ error: 'Reconnect Google Calendar and allow Calendar access.', reconnect: true });
      }
      failure(res);
    }
  };
  const disconnect: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = user(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to disconnect Google Calendar.' });
    // Deletion must still work if the Google OAuth configuration has been removed.
    if (!storageReady) return failure(res);
    try {
      const { error } = await db().from('google_tokens').delete().eq('user_id', userId);
      if (error) throw new Error('Token storage unavailable');
      res.status(204).end();
    } catch { failure(res); }
  };
  // Serialize per-account exchanges and disconnects in this server process. In
  // addition, conditional database writes protect refreshes across server replicas.
  const operations = new Map<string, Promise<void>>();
  const serialize = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    const id = user(req);
    if (!id) return handler(req, res, next);
    const previous = operations.get(id);
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; });
    operations.set(id, done);
    try {
      await previous;
      await handler(req, res, next);
    } catch { if (!res.headersSent) failure(res); }
    finally { release(); if (operations.get(id) === done) operations.delete(id); }
  };
  return { connect: serialize(connect), token: serialize(token), disconnect: serialize(disconnect) };
}
