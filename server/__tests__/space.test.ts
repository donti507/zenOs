import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  createSpaceEditor,
  spaceSettings,
  type SpaceEditStore,
} from "../space";
import { initialSpaceCode } from "../../shared/space";
let server: Server;
afterEach(
  () =>
    new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    ),
);
const pageId = "10000000-0000-0000-0000-000000000001",
  baseId = "20000000-0000-0000-0000-000000000001",
  editId = "20000000-0000-0000-0000-000000000002";
const now = new Date().toISOString();
const snapshot = {
  page: {
    id: pageId,
    slug: "study",
    title: "Study",
    currentVersionId: baseId,
    permissions: { tasks: false, events: false },
    createdAt: now,
    updatedAt: now,
  },
  version: {
    ...initialSpaceCode,
    id: baseId,
    pageId,
    kind: "initial" as const,
    prompt: "",
    reply: "",
    model: "",
    restoredFrom: null,
    createdAt: now,
  },
};
async function fixture(
  options: {
    cached?: boolean;
    stale?: boolean;
    deny?: boolean;
    generate?: any;
  } = {},
) {
  const generate =
    options.generate ||
    vi.fn(async () => ({
      html: "<main>Private page</main>",
      css: "",
      js: "",
      reply: "Done", explanation: "Added a heading so the page has a clear title.",
    }));
  const save = vi.fn(async () => snapshot);
  const storeFactory = vi.fn(
    (owner: string, id: string, authorization: string): SpaceEditStore => {
      expect(owner).toBe("verified-owner");
      expect(id).toBe(pageId);
      expect(authorization).toBe("Bearer verified");
      return {
        current: async () => snapshot,
        cached: async () =>
          options.cached
            ? {
                ...snapshot.version,
                id: editId,
                kind: "ai",
                prompt: "Build a page",
                model: "allowed",
              }
            : null,
        recent: async () => [],
        save,
      };
    },
  );
  const editor = createSpaceEditor({
    env: {
      LLM_BASE_URL: "https://provider.example/v1",
      LLM_MODEL: "allowed",
      SPACE_MODELS: "allowed,other",
    },
    store: storeFactory,
    generate,
  });
  let charges = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = req.headers["x-user"] || "verified-owner";
    next();
  });
  app.post(
    "/:id",
    editor.prepare,
    (_req, res, next) => {
      charges++;
      if (options.deny) return res.status(429).json({ error: "Daily limit" });
      next();
    },
    editor.edit,
  );
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (body: any = {}, owner = "verified-owner") =>
    fetch(base + "/" + pageId, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer verified",
        "x-user": owner,
      },
      body: JSON.stringify({
        prompt: "Build a page",
        model: "allowed",
        requestId: editId,
        expectedVersionId: options.stale ? editId : baseId,
        ...body,
      }),
    });
  return { call, generate, save, storeFactory, charges: () => charges };
}
it("loads verified-owner code instead of body code and stores every completed edit before responding", async () => {
  const f = await fixture();
  const response = await f.call({
    user_id: "foreign",
    current: { html: "FORGED", css: "", js: "" },
  });
  expect(response.status).toBe(200);
  expect(f.generate).toHaveBeenCalledWith(
    expect.anything(),
    "allowed",
    snapshot.version,
    [],
    "Build a page",
    expect.any(AbortSignal),
  );
  expect(f.save).toHaveBeenCalledWith(
    editId,
    baseId,
    "Build a page",
    "allowed",
    expect.objectContaining({ html: "<main>Private page</main>", explanation: "Added a heading so the page has a clear title." }),
    expect.any(AbortSignal),
  );
  expect(f.charges()).toBe(1);
});
it("validates model allowlists and stale revisions before consuming daily allowance", async () => {
  const f = await fixture({ stale: true });
  expect((await f.call({ model: "https://evil.example" })).status).toBe(400);
  expect((await f.call()).status).toBe(409);
  expect(f.charges()).toBe(0);
  expect(f.generate).not.toHaveBeenCalled();
  expect(
    spaceSettings({
      LLM_BASE_URL: "https://provider",
      LLM_MODEL: "a",
      SPACE_MODELS: "a,b,c,d",
    }).models,
  ).toEqual([]);
});
it("returns saved retries without another provider call or quota reservation", async () => {
  const f = await fixture({ cached: true });
  expect((await f.call()).status).toBe(200);
  expect(f.charges()).toBe(0);
  expect(f.generate).not.toHaveBeenCalled();
  expect((await f.call({ prompt: "Different edit" })).status).toBe(409);
});
it("respects quota rejection and never generates for denied requests", async () => {
  const f = await fixture({ deny: true });
  expect((await f.call()).status).toBe(429);
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("supports bounded local code with the same quota pipeline and keeps provider errors private", async () => {
  const f = await fixture({
    generate: vi.fn(async () => {
      throw new Error("PRIVATE_PROVIDER_KEY");
    }),
  });
  const response = await f.call({ current: initialSpaceCode }, "anon:local");
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("PRIVATE_PROVIDER_KEY");
  expect(f.storeFactory).not.toHaveBeenCalled();
  expect(f.charges()).toBe(1);
  expect(f.save).not.toHaveBeenCalled();
});

it("rejects invalid explanations before saving an AI edit",async()=>{
 const f=await fixture({generate:vi.fn(async()=>({html:'',css:'',js:'',reply:'Done',explanation:'x'.repeat(1201)}))});
 expect((await f.call()).status).toBe(502);expect(f.save).not.toHaveBeenCalled();
});
