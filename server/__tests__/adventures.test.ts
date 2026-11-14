import { afterEach, it, expect, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createAdventures } from "../adventures";
import { lostBinaryKingdom } from "../../src/game/samples/lost-binary-kingdom";
let server: Server;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});
async function setup(missing=false) {
  const filters: any[] = [],
    insert = vi.fn((_row: any) => query),
    query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((...args) => {
        filters.push(args);
        return query;
      }),
      abortSignal: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: missing?null:{
          id: "x",
          summary: "Binary values double from right to left.",
          key_points: ["One then two then four."],
          flashcards: [],
        },
      })),
    };
  const db = { from: vi.fn(() => ({ ...query, insert })) },
    generate = vi.fn(async () => ({
      spec: lostBinaryKingdom,
      answers: {
        private: {
          type: "gate" as const,
          key: { kind: "text" as const, value: "NEVER_RETURN" },
        },
      },
      source_refs: [],
    }));
  query.then = (resolve: any) => resolve({ error: null });
  const h = createAdventures({ db, generate, ready: true });
  const app = express();
  app.use((req, _res, next) => {
    (req as any).userId = req.headers["x-user"];
    next();
  });
  let quota = 0;
  app.post(
    "/generate",
    h.signed,
    h.acquire,
    h.body,
    h.prepare,
    (_req, _res, next) => {
      quota++;
      next();
    },
    h.generate,
  );
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const url = `http://127.0.0.1:${(server.address() as any).port}/generate`;
  return {
    call: (body: unknown, user = "verified-owner") =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": user },
        body: JSON.stringify(body),
      }),
    filters,
    insert,
    generate,
    quota: () => quota,
  };
}
it("requires real identity, rejects body ownership and uses only canonical owned lecture data", async () => {
  const f = await setup(),
    lectureId = "11111111-1111-4111-8111-111111111111";
  expect((await f.call({ lectureId }, "anon:1")).status).toBe(401);
  expect((await f.call({ lectureId, user_id: "victim" })).status).toBe(400);
  expect(f.quota()).toBe(0);
  const res = await f.call({ lectureId });
  expect(res.status).toBe(200);
  const stream = await res.text();
  expect(stream).toContain('"type":"ready"');
  expect(stream).not.toContain("NEVER_RETURN");
  expect(f.filters).toContainEqual(["user_id", "verified-owner"]);
  expect(f.insert.mock.calls[0][0].user_id).toBe("verified-owner");
  expect(f.quota()).toBe(1);
});

it('rejects missing or unowned lectures before charging quota',async()=>{const f=await setup(true);expect((await f.call({lectureId:'11111111-1111-4111-8111-111111111111'})).status).toBe(404);expect(f.quota()).toBe(0);expect(f.generate).not.toHaveBeenCalled();});
it('fails cleanly without leaking raw provider errors or storing failed worlds',async()=>{const f=await setup();f.generate.mockRejectedValueOnce(new Error('SECRET provider document'));const res=await f.call({lectureId:'11111111-1111-4111-8111-111111111111'});const stream=await res.text();expect(stream).toContain('"type":"error"');expect(stream).not.toContain('SECRET');expect(f.insert).not.toHaveBeenCalled();});
