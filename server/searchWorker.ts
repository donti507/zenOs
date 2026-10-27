/** Durable rows live in Postgres; this small poller owns no document content. */
export function createSearchWorker(options: {
  candidates: (excluded: string[]) => Promise<string[]>;
  run: (
    owner: string,
    signal: AbortSignal,
  ) => Promise<"done" | "quota" | "busy">;
  now?: () => number;
  intervalMs?: number;
}) {
  const now = options.now || Date.now;
  const blocked = new Map<string, number>();
  let active = false;
  let stopped = false;
  let failures = 0;
  let retryAt = 0;
  const abort = new AbortController();
  const tick = async () => {
    if (active || stopped || now() < retryAt) return;
    active = true;
    try {
      for (const [id, until] of blocked) if (now() >= until) blocked.delete(id);
      const owners = await options.candidates([...blocked.keys()]);
      for (const owner of [...new Set(owners)].slice(0, 8)) {
        if (stopped) break;
        if (blocked.has(owner)) continue;
        const result = await options.run(owner, abort.signal);
        if (result === "quota") {
          const date = new Date(now());
          blocked.set(
            owner,
            Date.UTC(
              date.getUTCFullYear(),
              date.getUTCMonth(),
              date.getUTCDate() + 1,
            ),
          );
        }
        if (result === "done") {
          failures = 0;
          retryAt = 0;
          break;
        }
      }
    } catch {
      retryAt =
        now() +
        Math.min(
          900000,
          60000 * 2 ** Math.min(failures++, 4),
        ); /* Keep the queue pending; no content logs. */
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, options.intervalMs || 15000);
  timer.unref();
  return {
    tick,
    close: () => {
      stopped = true;
      clearInterval(timer);
      abort.abort();
    },
  };
}
