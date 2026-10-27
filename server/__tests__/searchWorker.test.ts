import { expect, it, vi } from "vitest";
import { createSearchWorker } from "../searchWorker";
it("defers quota-exhausted accounts until UTC reset while indexing other accounts", async () => {
  let now = Date.UTC(2026, 9, 27, 23, 59);
  const run = vi.fn(async (owner: string) =>
    owner === "a" ? ("quota" as const) : ("done" as const),
  );
  const candidates = vi.fn(async () => ["a", "b"]);
  const worker = createSearchWorker({ now: () => now, candidates, run });
  try {
    await worker.tick();
    expect(run.mock.calls.map(([owner]) => owner)).toEqual(["a", "b"]);
    await worker.tick();
    expect(candidates).toHaveBeenLastCalledWith(["a"]);
    expect(run.mock.calls.map(([owner]) => owner)).toEqual(["a", "b", "b"]);
    now += 120000;
    await worker.tick();
    expect(candidates).toHaveBeenLastCalledWith([]);
    expect(run.mock.calls.map(([owner]) => owner)).toEqual([
      "a",
      "b",
      "b",
      "a",
      "b",
    ]);
  } finally {
    worker.close();
  }
});
it("does not overlap ticks and retries failed work without losing the durable queue", async () => {
  let now = Date.UTC(2026, 9, 27);
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const run = vi.fn(async () => {
    await hold;
    throw new Error("provider failure");
  });
  const worker = createSearchWorker({
    now: () => now,
    candidates: async () => ["a"],
    run,
  });
  try {
    const first = worker.tick();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await worker.tick();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await worker.tick();
    expect(run).toHaveBeenCalledTimes(1);
    now += 61000;
    await worker.tick();
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    worker.close();
  }
});
