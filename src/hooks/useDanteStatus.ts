import { useEffect, useState } from 'react';

export type DanteStatus = { ready: boolean; provider: string; model: string | null; problem: string | null; authRequired: boolean; stt?: boolean; tts?: boolean };

let cache: Promise<DanteStatus | null> | null = null;

/** Fetches /api/dante/status once per page load and shares the result. */
export function useDanteStatus() {
  const [status, setStatus] = useState<DanteStatus | null>(null);
  useEffect(() => {
    cache ??= fetch('/api/dante/status').then(r => (r.ok ? r.json() : null)).catch(() => null);
    let alive = true;
    cache.then(s => alive && setStatus(s));
    return () => { alive = false; };
  }, []);
  return status;
}
