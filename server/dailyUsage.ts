import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import type { DanteUsage } from '../shared/danteUsage';
import { captureServerError } from './monitoring';

type Kind = 'messages' | 'transcriptions';
export function dailyLimit(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647 ? parsed : 20;
}
export function usageDay(now = new Date()) {
  const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  return { date, resetsAt };
}
function summary(row: { date: string; messages: number; transcriptions: number }, limit: number): Extract<DanteUsage, { enabled: true }> {
  const resetsAt = new Date(`${row.date}T00:00:00.000Z`); resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { enabled: true, ...row, limit, resetsAt: resetsAt.toISOString(), messagesRemaining: Math.max(0, limit - row.messages), transcriptionsRemaining: Math.max(0, limit - row.transcriptions) };
}

/** Injectable client factory lets tests exercise HTTP enforcement without credentials. */
export function createDailyUsage(options: { key?: string; url?: string; limit?: string; client?: () => SupabaseClient } = {}) {
  const limit = dailyLimit(options.limit);
  let client: SupabaseClient | undefined;
  const getClient = () => client ??= options.client ? options.client() : createClient(options.url || '', options.key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const enabled = (userId: string | undefined) => !!options.key?.trim() && !!userId && !userId.startsWith('anon:');
  const unavailable = 'We couldn’t check today’s Dante usage. Please try again shortly.';

  const count = (kind: Kind): RequestHandler => async (req, res, next) => {
    const userId: string | undefined = (req as any).userId;
    if (!enabled(userId)) return next();
    try {
      const { data, error } = await getClient().rpc('consume_dante_usage', { p_user_id: userId, p_kind: kind, p_limit: limit });
      if (error) throw error;
      const row = data?.[0];
      if (!row || typeof row.allowed !== 'boolean') throw new Error('Invalid daily usage response');
      const usage = summary({ date: row.date, messages: row.messages, transcriptions: row.transcriptions }, limit);
      res.setHeader('Cache-Control', 'no-store');
      if (!row.allowed) {
        const seconds = Math.max(1, Math.ceil((new Date(usage.resetsAt).getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', seconds);
        return res.status(429).json({ error: `You’ve used your ${limit} Dante ${kind === 'messages' ? 'messages' : 'transcriptions'} for today. Take a breather and come back after midnight UTC.`, usage });
      }
      next();
    } catch (error) {
      captureServerError(error);
      return res.status(503).json({ error: unavailable });
    }
  };
  const read: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId: string | undefined = (req as any).userId;
    if (!enabled(userId)) return res.json({ enabled: false });
    try {
      const { date } = usageDay();
      const { data, error } = await getClient().from('dante_usage').select('date,messages,transcriptions').eq('user_id', userId).eq('date', date).maybeSingle();
      if (error) throw error;
      res.json(summary(data || { date, messages: 0, transcriptions: 0 }, limit));
    } catch (error) {
      captureServerError(error);
      res.status(503).json({ error: unavailable });
    }
  };
  return { count, read };
}
