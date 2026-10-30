import { createClient } from '@supabase/supabase-js';

/**
 * Supabase config is resolved in this order:
 * 1. window.__ZENOS_CONFIG__  — injected by server.ts at runtime in production,
 *    so one Docker image works in any environment without rebuilding.
 * 2. import.meta.env.VITE_*   — used by `npm run dev`.
 */
type RuntimeConfig = { supabaseUrl?: string; supabaseAnonKey?: string };

const runtime: RuntimeConfig =
  (typeof window !== 'undefined' && (window as any).__ZENOS_CONFIG__) || {};

const env = (import.meta as any).env || {};

const rawUrl: string = runtime.supabaseUrl || env.VITE_SUPABASE_URL || '';
const rawKey: string = runtime.supabaseAnonKey || env.VITE_SUPABASE_ANON_KEY || '';

/** True only when real Supabase credentials are present. When false the app runs in local-only mode. */
export const SUPABASE_CONFIGURED =
  rawUrl.startsWith('http') && rawKey.length > 20 && !/your[-_]/i.test(rawUrl + rawKey);

if (!SUPABASE_CONFIGURED && typeof window !== 'undefined') {
  console.warn('[ZEN_OS] Supabase is not configured. Data will be stored in this browser only.');
}

const getResilientStorage = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const testKey = '__storage_test__';
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
  } catch {
    console.warn('Supabase auth falling back to in-memory storage because localStorage is blocked.');
  }
  const mem: Record<string, string> = {};
  return {
    getItem: (key: string) => mem[key] ?? null,
    setItem: (key: string, value: string) => { mem[key] = value; },
    removeItem: (key: string) => { delete mem[key]; },
  };
};

// The placeholder values only exist so createClient() doesn't throw; nothing is ever sent
// to them because every data call checks SUPABASE_CONFIGURED / offline mode first.
export const supabase = createClient(
  SUPABASE_CONFIGURED ? rawUrl : 'https://placeholder.supabase.co',
  SUPABASE_CONFIGURED ? rawKey : 'placeholder-anon-key-not-configured',
  {
    auth: {
      // USOS fragments are verified explicitly after the browser-bound server handoff.
      detectSessionInUrl:typeof window==='undefined'||!/^\/auth\/usos\/?$/.test(window.location.pathname),
      persistSession: true,
      autoRefreshToken: true,
      storage: getResilientStorage(),
    },
  }
);
