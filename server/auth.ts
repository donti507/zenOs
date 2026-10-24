import type { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
export const SUPABASE_CONFIGURED = url.startsWith('http') && anonKey.length > 20 && !/your[-_]/i.test(url + anonKey);

/** Allow AI calls without login (local-only/demo mode). Off by default in production. */
export const ALLOW_ANONYMOUS =
  process.env.DANTE_ALLOW_ANONYMOUS === 'true' || (!SUPABASE_CONFIGURED && process.env.NODE_ENV !== 'production');

let client: SupabaseClient | null = null;
const getClient = () => (client ??= createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }));

// Small cache so every chat message doesn't cost an extra round-trip to Supabase
const cache = new Map<string, { userId: string; exp: number }>();

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    if (ALLOW_ANONYMOUS) {
      (req as any).userId = `anon:${req.ip}`;
      return next();
    }
    return res.status(401).json({ error: 'Sign in to use Dante. (Local/demo mode cannot use the AI on this server.)' });
  }
  if (!SUPABASE_CONFIGURED) {
    return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_ANON_KEY.' });
  }

  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) {
    (req as any).userId = hit.userId;
    return next();
  }

  try {
    const { data, error } = await getClient().auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    cache.set(token, { userId: data.user.id, exp: Date.now() + 60_000 });
    if (cache.size > 5000) cache.clear();
    (req as any).userId = data.user.id;
    next();
  } catch (err) {
    console.error('[auth] verification failed', err);
    res.status(503).json({ error: 'Could not verify your session. Try again.' });
  }
}

/** Fixed-window limiter per user: DANTE_RATE_LIMIT requests per minute (default 20). */
const LIMIT = Number(process.env.DANTE_RATE_LIMIT || 20);
const windows = new Map<string, { count: number; reset: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = (req as any).userId || req.ip || 'unknown';
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.reset < now) {
    w = { count: 0, reset: now + 60_000 };
    windows.set(key, w);
  }
  w.count++;
  if (w.count > LIMIT) {
    res.setHeader('Retry-After', Math.ceil((w.reset - now) / 1000));
    return res.status(429).json({ error: `Too many messages. Wait ${Math.ceil((w.reset - now) / 1000)}s and try again.` });
  }
  if (windows.size > 10000) windows.clear();
  next();
}
