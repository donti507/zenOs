import { expect, it, vi } from "vitest";
import { createEmbedder, validateVector } from "../embeddings";
const vector = (index = 0) =>
  Array.from({ length: 1024 }, (_, i) => (i === index ? 2 : 0));
it("uses the configured embeddings endpoint/model, orders by index and normalizes 1024-dimensional vectors", async () => {
  const request = vi.fn(async (url: any, options: any) => {
    expect(url).toBe("https://ai.example/v1/embeddings");
    expect(options.headers.Authorization).toBe("Bearer private");
    expect(JSON.parse(options.body)).toMatchObject({
      model: "Qwen3-Embedding-0.6B",
      input: ["query", "document"],
      encoding_format: "float",
    });
    return Response.json({
      data: [
        { index: 1, embedding: vector(1) },
        { index: 0, embedding: vector(0) },
      ],
    });
  });
  const embedder = createEmbedder({
    env: {
      LLM_BASE_URL: "https://ai.example/v1/chat/completions",
      LLM_API_KEY: "private",
    },
    request,
  });
  const result = await embedder.embed(
    ["query", "document"],
    new AbortController().signal,
  );
  expect(result[0][0]).toBe(1);
  expect(result[1][1]).toBe(1);
  expect(result[0]).toHaveLength(1024);
});
it("rejects wrong dimensions, zero/NaN vectors and duplicate response indices", async () => {
  for (const v of [[1, 2], Array(1024).fill(0), [NaN, ...vector().slice(1)]])
    expect(() => validateVector(v)).toThrow();
  const embedder = createEmbedder({
    env: { LLM_BASE_URL: "https://ai.example" },
    request: async () =>
      Response.json({
        data: [
          { index: 0, embedding: vector() },
          { index: 0, embedding: vector() },
        ],
      }),
  });
  await expect(
    embedder.embed(["a", "b"], new AbortController().signal),
  ).rejects.toThrow("indices");
});
it("never echoes provider error bodies and aborts cancelled requests", async () => {
  const embedder = createEmbedder({
    env: { LLM_BASE_URL: "https://ai.example" },
    request: async () => new Response("secret credential", { status: 401 }),
  });
  await expect(
    embedder.embed(["hello"], new AbortController().signal),
  ).rejects.toThrow("embedding provider is unavailable");
  const invalid = createEmbedder({
    env: { LLM_BASE_URL: "https://ai.example" },
    request: async () => new Response("secret credential"),
  });
  await expect(
    invalid.embed(["hello"], new AbortController().signal),
  ).rejects.toThrow("Invalid embedding response");
  const abort = new AbortController();
  abort.abort();
  const cancelled = createEmbedder({
    env: { LLM_BASE_URL: "https://ai.example" },
    request: async (_url, options) => {
      options!.signal!.throwIfAborted();
      return Response.json({ data: [] });
    },
  });
  await expect(cancelled.embed(["hello"], abort.signal)).rejects.toThrow();
});
