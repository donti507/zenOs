import express from "express";
import { afterEach, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createAdventureRuntime } from "../adventureRuntime";
import { lostBinaryKingdom as spec } from "../../src/game/samples/lost-binary-kingdom";
import { emptyAdventureRun } from "../../src/game/systems/adaptation";
let server: Server;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
const adventureId = "11111111-1111-4111-8111-111111111111";
async function fixture() {
  let state: any = null;
  const keys = {
    "power-path": { type: "sequence", order: [1, 3, 2, 0] },
    "practice-powers": { type: "sequence", order: [1, 3, 2, 0] },
    "east-gate": { type: "gate", key: { kind: "text", value: "NEVER_PUBLIC" } },
  };
  const queries: any[] = [];
  const db = {
    from: vi.fn((table: string) => {
      const filters: Record<string, string> = {};
      let columns = "";
      const q: any = {
        select: (s: string) => {
          columns = s;
          return q;
        },
        eq: (k: string, v: string) => {
          filters[k] = v;
          return q;
        },
        maybeSingle: async () => {
          queries.push({ table, columns, filters });
          if (filters.user_id !== "owner") return { data: null };
          return {
            data:
              table === "adventures"
                ? {
                    id: adventureId,
                    spec,
                    ...(columns.includes("answers") ? { answers: keys } : {}),
                  }
                : state,
          };
        },
      };
      return q;
    }),
    rpc: vi.fn(async (_name: string, args: any) => {
      if ((state?.revision ?? 0) !== args.p_revision) return { data: false };
      state = {
        revision: args.p_revision + 1,
        run: args.p_run,
        receipts: args.p_receipts,
      };
      return { data: true };
    }),
  };
  const h = createAdventureRuntime({ db }),
    app = express();

  app.use((req, _res, next) => {
    (req as any).userId = req.headers["x-user"];
    next();
  });
  app.get("/:id/progress", h.signed, h.get);
  app.post("/:id/actions", h.signed, h.body, h.act);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as any).port}/${adventureId}`;
  const act = (body: any, user = "owner") =>
    fetch(url + "/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user": user },
      body: JSON.stringify({ requestId: randomUUID(), ...body }),
    });
  return {
    act,
    db,
    queries,
    state: () => state,
    get: (user = "owner") =>
      fetch(url + "/progress", { headers: { "x-user": user } }),
  };
}
it("verifies identity/ownership, rejects client correctness and keeps all keys server-only", async () => {
  const f = await fixture();
  expect((await f.get("anon:ip")).status).toBe(401);
  expect((await f.get("other")).status).toBe(404);
  expect(
    (
      await f.act({
        type: "answer",
        missionId: "power-path",
        answer: { type: "sequence", order: [1, 3, 2, 0] },
        correct: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.act({ type: "accept", missionId: "practice-powers" })).status,
  ).toBe(409);
  expect((await f.get()).status).toBe(200);
  expect(
    f.queries
      .filter((q) => q.table === "adventures")
      .every((q) => !q.columns.includes("answers")),
  ).toBe(true);
  expect(f.db.rpc).not.toHaveBeenCalled();
});
it("idempotently records checked evidence, escalates hints and unlocks practice without LLM or extra XP", async () => {
  const f = await fixture();
  await f.act({ type: "accept", missionId: "power-path" });
  const requestId = randomUUID(),
    wrong = {
      type: "answer",
      missionId: "power-path",
      requestId,
      answer: { type: "sequence", order: [0, 1, 2, 3] },
    };
  await f.act(wrong);
  await f.act(wrong);
  expect(f.state().run.learning.missions["power-path"].attempts).toBe(1);
  await f.act({ ...wrong, requestId: randomUUID() });
  expect(f.state().run.learning.missions["power-path"].hintLevel).toBe(2);
  expect(
    (await f.act({ type: "accept", missionId: "practice-powers" })).status,
  ).toBe(200);
  const solved = await (
    await f.act({
      type: "answer",
      missionId: "practice-powers",
      answer: { type: "sequence", order: [1, 3, 2, 0] },
    })
  ).json();
  expect(solved.xpGranted).toBe(0);
  expect(solved.run.engagement.progress.completed).toContain("practice-powers");
  expect(JSON.stringify(solved)).not.toContain("NEVER_PUBLIC");
  expect(f.state().run.learning.missions["power-path"].wrongAttempts).toBe(2);
});
it("returns initial separated metrics, counts explanations as assistance and never returns a secret in errors", async () => {
  const f = await fixture();
  expect((await (await f.get()).json()).run).toEqual(emptyAdventureRun());
  await f.act({ type: "accept", missionId: "power-path" });
  const explanation = await (
    await f.act({ type: "explanation", conceptId: "place-values" })
  ).json();
  expect(explanation.run.learning.missions["power-path"].hintLevel).toBe(2);
  const failed = await f.act({
    type: "answer",
    missionId: "east-gate",
    answer: { type: "gate", value: "x" },
  });
  expect(failed.status).toBe(409);
  expect(await failed.text()).not.toContain("NEVER_PUBLIC");
});

it("merges simultaneous device attempts with revision retries instead of losing mastery evidence", async () => {
  const f = await fixture();
  await f.act({ type: "accept", missionId: "power-path" });
  const wrong = {
    type: "answer",
    missionId: "power-path",
    answer: { type: "sequence", order: [0, 1, 2, 3] },
  };
  const responses = await Promise.all([f.act(wrong), f.act(wrong)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(f.state().run.learning.missions["power-path"]).toMatchObject({
    attempts: 2,
    wrongAttempts: 2,
    hintLevel: 2,
  });
});
