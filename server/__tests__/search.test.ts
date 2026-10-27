import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  createSemanticSearch,
  type PendingEmbedding,
  type SearchStore,
} from "../search";
import { createDailyUsage } from "../dailyUsage";
let server: Server;
afterEach(
  () =>
    new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    ),
);
const id = "10000000-0000-0000-0000-000000000001";
const vec = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
async function fixture(
  options: {
    limit?: number;
    mutateDuringEmbed?: boolean;
    hold?: Promise<void>;
  } = {},
) {
  const pending = new Map<string, PendingEmbedding[]>([
    [
      "owner",
      [
        {
          source_type: "meeting",
          source_id: id,
          chunk_index: 0,
          title: "Alex: Launch",
          content: "Alex said launch Friday.",
          revision: "revision-1",
        },
      ],
    ],
    ["other", []],
  ]);
  const indexed = new Map<string, PendingEmbedding[]>();
  const owners: string[] = [];
  const saved = vi.fn();
  const store = (owner: string, auth: string): SearchStore => {
    owners.push(owner);
    expect(auth).toBe("Bearer verified");
    return {
      pending: async () => ({
        rows: [...(pending.get(owner) || [])],
        count: pending.get(owner)?.length || 0,
      }),
      save: async (row) => {
        saved(row);
        if (options.mutateDuringEmbed) return false;
        pending.set(
          owner,
          (pending.get(owner) || []).filter((p) => p !== row),
        );
        indexed.set(owner, [...(indexed.get(owner) || []), row]);
        return true;
      },
      match: async () =>
        indexed
          .get(owner)
          ?.map((row) => ({
            sourceType: row.source_type,
            sourceId: row.source_id,
            title: row.title,
            content: row.content,
            score: 0.9,
          })) || [],
      source: async (type, sourceId) =>
        owner === "owner" && sourceId === id
          ? {
              sourceType: type,
              sourceId,
              title: "Alex: Launch",
              content: "Alex said launch Friday.",
            }
          : null,
    };
  };
  const embed = vi.fn(async (input: string[]) => {
    await options.hold;
    return input.map(() => vec);
  });
  const search = createSemanticSearch({
    store,
    embedder: {
      config: {
        baseUrl: "https://ai.example",
        model: "test",
        space: "space",
        apiKey: undefined,
        extraHeaders: {},
      },
      embed,
    },
  });
  let charges = 0;
  const daily = createDailyUsage({
    key: "server",
    url: "https://db.example",
    limit: String(options.limit || 20),
    client: () =>
      ({
        rpc: async (_fn: string, body: any) => {
          expect(body.p_user_id).toBe("owner");
          charges++;
          return {
            data: [
              {
                allowed: charges <= (options.limit || 20),
                date: "2026-10-27",
                messages: Math.min(charges, options.limit || 20),
                transcriptions: 0,
              },
            ],
          };
        },
      }) as any,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = req.headers["x-user"];
    next();
  });
  app.post(
    "/index",
    search.prepareIndex,
    daily.count("messages"),
    search.index,
  );
  app.post(
    "/query",
    search.prepareQuery,
    daily.count("messages"),
    search.query,
  );
  app.get("/source", search.source);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (
    path: string,
    body: any = {},
    owner = "owner",
    method = "POST",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-user": owner,
        Authorization: "Bearer verified",
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  return { call, embed, owners, charges: () => charges, saved };
}
it("indexes canonical owner rows, ignores forged body identities, skips quota for a clean index and retrieves with sources", async () => {
  const f = await fixture();
  expect(
    await (
      await f.call("/index", { user_id: "other", content: "forged" })
    ).json(),
  ).toMatchObject({ indexed: 1, pending: 0 });
  expect(f.charges()).toBe(1);
  await f.call("/index");
  expect(f.charges()).toBe(1);
  expect(f.embed).toHaveBeenCalledTimes(1);
  expect(f.embed.mock.calls[0][0]).toEqual(["meeting: Alex: Launch\nAlex said launch Friday."]);
  const result = await (
    await f.call("/query", {
      query: "What did Alex say about launch?",
      user_id: "other",
    })
  ).json();
  expect(result.results[0]).toMatchObject({
    sourceId: id,
    sourceType: "meeting",
  });
  expect(f.owners.every((owner) => owner === "owner")).toBe(true);
  expect(f.charges()).toBe(2);
  expect(
    (await f.call(`/source?type=meeting&id=${id}`, {}, "other", "GET")).status,
  ).toBe(404);
  expect(
    (await f.call(`/source?type=meeting&id=${id}`, {}, "owner", "GET")).status,
  ).toBe(200);
  expect(f.charges()).toBe(2);
});
it("enforces the same daily allowance before any embedding request", async () => {
  const f = await fixture({ limit: 1 });
  await f.call("/query", { query: "launch" });
  const denied = await f.call("/query", { query: "launch" });
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toBeTruthy();
  expect(f.embed).toHaveBeenCalledTimes(1);
});
it("does not index anonymous identities or invalid queries and keeps changed content pending", async () => {
  const f = await fixture({ mutateDuringEmbed: true });
  expect((await f.call("/query", { query: "x" }, "anon:ip")).status).toBe(401);
  expect((await f.call("/query", { query: " " })).status).toBe(400);
  expect(f.charges()).toBe(0);
  const result = await (await f.call("/query", { query: "launch" })).json();
  expect(result.pending).toBe(1);
  expect(result.results).toEqual([]);
});
it("rejects overlapping work before consuming another quota unit", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({ hold });
  const first = f.call("/index");
  await vi.waitFor(() => expect(f.embed).toHaveBeenCalledTimes(1));
  expect((await f.call("/index")).status).toBe(409);
  expect(f.charges()).toBe(1);
  release();
  expect((await first).status).toBe(200);
});
