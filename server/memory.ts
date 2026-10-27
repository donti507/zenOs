import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { recentMemory } from '../shared/danteMemory';
import type { DanteContext } from './prompt';

/** Read with the verified user's bearer token/RLS, never a service role or body user ID. */
export function createDanteMemoryReader(options: { env?: NodeJS.ProcessEnv; client?: (token: string) => SupabaseClient } = {}) {
  const env = options.env ?? process.env;
  return async (userId: string | undefined, authorization: string | undefined, context: DanteContext = {}): Promise<DanteContext> => {
    const supplied = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    if (!userId || userId.startsWith('anon:')) return { ...supplied, memory: recentMemory(supplied.memory) };
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) throw new Error('Authenticated memory requires a verified session');
    const client = options.client ? options.client(token) : createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '', env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '', {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.from('dante_memory').select('id,fact,created_at').eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30);
    if (error) throw new Error('Dante memory is temporarily unavailable');
    // Authenticated caller-provided memory is always replaced by owned database facts.
    return { ...supplied, memory: recentMemory(data) };
  };
}
