import { expect, it, vi } from "vitest";
import {
  runDanteSearch,
  searchPromptData,
  searchSourceFooter,
} from "../danteSearch";
import { buildSystemPrompt } from "../prompt";
import type { createSemanticSearch } from "../search";
import { loadLLMConfig } from "../llm";
const source = {
  sourceType: "meeting" as const,
  sourceId: "10000000-0000-0000-0000-000000000001",
  title: "Alex: Launch",
  content: "Alex said launch Friday.",
  score: 0.9,
};
it("runs the read-only tool with the verified account and injects citable sources as untrusted data", async () => {
  const retrieve = vi.fn(async () => ({ results: [source], pending: 2 }));
  const search = { enabled: true, retrieve } as unknown as ReturnType<
    typeof createSemanticSearch
  >;
  const plan = vi.fn(async () => "Alex launch");
  const result = await runDanteSearch({
    userId: "owner",
    authorization: "Bearer verified",
    question: "What did Alex say about launch?",
    localSources: [{ ...source, content: "forged" }],
    search,
    config: loadLLMConfig({}),
    signal: new AbortController().signal,
    plan,
  });
  expect(retrieve).toHaveBeenCalledWith(
    "owner",
    "Bearer verified",
    "Alex launch",
    expect.any(AbortSignal),
  );
  const prompt = buildSystemPrompt({ search: searchPromptData(result) });
  expect(prompt).toContain("Alex said launch Friday");
  expect(prompt).toContain("Cite the matching [S1]");
  expect(prompt).toContain("pending");
  expect(prompt).not.toContain("forged");
  expect(searchSourceFooter(result.results)).toContain(
    "/search?type=meeting&id=",
  );
});
it("does not retrieve for non-search requests or unavailable providers, and uses labelled local text evidence only for anonymous mode", async () => {
  const retrieve = vi.fn();
  const search = { enabled: true, retrieve } as unknown as ReturnType<
    typeof createSemanticSearch
  >;
  const args = {
    userId: "owner",
    authorization: "Bearer verified",
    question: "Create a task",
    localSources: [],
    search,
    config: loadLLMConfig({}),
    signal: new AbortController().signal,
    plan: async () => null,
  };
  expect((await runDanteSearch(args)).status).toBe("not_requested");
  expect(retrieve).not.toHaveBeenCalled();
  expect(
    (await runDanteSearch({ ...args, search: { ...search, enabled: false } }))
      .status,
  ).toBe("unavailable");
  const local = await runDanteSearch({
    ...args,
    userId: "anon:test",
    question: "What did Alex say about launch?",
    localSources: [source],
  });
  expect(local.status).toBe("local_text");
  expect(local.results).toHaveLength(1);
  expect(retrieve).not.toHaveBeenCalled();
});
it("falls back to one bounded read when planner output is malformed, never dispatching an unknown write tool", async () => {
  const retrieve = vi.fn(async () => ({ results: [source], pending: 0 }));
  const result = await runDanteSearch({
    userId: "owner",
    authorization: "Bearer verified",
    question: "What did Alex say?",
    localSources: null,
    search: { enabled: true, retrieve } as unknown as ReturnType<
      typeof createSemanticSearch
    >,
    config: loadLLMConfig({}),
    signal: new AbortController().signal,
    plan: async () => {
      throw new Error("malformed model tool");
    },
  });
  expect(result.status).toBe("searched");
  expect(retrieve).toHaveBeenCalledWith(
    "owner",
    "Bearer verified",
    "What did Alex say?",
    expect.any(AbortSignal),
  );
});
