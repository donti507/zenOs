import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "../shared/search";
export function embeddingConfig(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = (env.LLM_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  const model = env.EMBEDDING_MODEL?.trim() || "Qwen3-Embedding-0.6B";
  let extraHeaders: Record<string, string> = {};
  try {
    const raw = JSON.parse(env.LLM_EXTRA_HEADERS || "{}");
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.values(raw).every((v) => typeof v === "string")
    )
      extraHeaders = raw;
  } catch {}
  return {
    baseUrl,
    model,
    apiKey: env.LLM_API_KEY,
    extraHeaders,
    space: createHash("sha256")
      .update(`${baseUrl}\0${model}\0${EMBEDDING_DIMENSIONS}`)
      .digest("hex"),
  };
}
export function validateVector(raw: unknown): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length !== EMBEDDING_DIMENSIONS ||
    raw.some((v) => typeof v !== "number" || !Number.isFinite(v))
  )
    throw new Error(
      "Embedding provider must return 1024 finite dimensions. Check EMBEDDING_MODEL.",
    );
  const norm = Math.hypot(...raw);
  if (!Number.isFinite(norm) || norm <= 0)
    throw new Error("Embedding provider returned an invalid vector.");
  return raw.map((v) => v / norm);
}
export function createEmbedder(
  options: { env?: NodeJS.ProcessEnv; request?: typeof fetch } = {},
) {
  const config = embeddingConfig(options.env);
  const request = options.request || fetch;
  return {
    config,
    async embed(input: string[], signal: AbortSignal) {
      if (!config.baseUrl)
        throw new Error(
          "Semantic search needs LLM_BASE_URL configured on the server.",
        );
      if (
        !input.length ||
        input.length > 17 ||
        input.some(
          (text) =>
            typeof text !== "string" ||
            !text.trim() ||
            Array.from(text).length > 3000,
        )
      )
        throw new Error("Invalid embedding batch.");
      const response = await request(`${config.baseUrl}/embeddings`, {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        headers: {
          ...config.extraHeaders,
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          input,
          encoding_format: "float",
        }),
      });
      if (!response.ok)
        throw new Error(
          "The embedding provider is unavailable. Check the server embedding configuration.",
        );
      const body = await response.text();
      if (body.length > 2_000_000)
        throw new Error("Embedding response too large.");
      let data: any;
      try {
        data = JSON.parse(body).data;
      } catch {
        throw new Error("Invalid embedding response.");
      }
      if (!Array.isArray(data) || data.length !== input.length)
        throw new Error("Invalid embedding response.");
      const ordered = new Map<number, number[]>();
      for (const row of data) {
        if (
          !Number.isInteger(row.index) ||
          row.index < 0 ||
          row.index >= input.length ||
          ordered.has(row.index)
        )
          throw new Error("Invalid embedding indices.");
        ordered.set(row.index, validateVector(row.embedding));
      }
      return input.map((_, i) => ordered.get(i)!);
    },
  };
}
