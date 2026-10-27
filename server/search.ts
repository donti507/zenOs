import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, RequestHandler } from "express";
import { createSearchWorker } from "./searchWorker";
import { createEmbedder } from "./embeddings";
import {
  isSearchType,
  readSearchResults,
  readSearchSource,
  searchQuery,
  type SearchResult,
  type SearchSource,
  type SearchType,
} from "../shared/search";
export type PendingEmbedding = {
  source_type: SearchType;
  source_id: string;
  chunk_index: number;
  title: string;
  content: string;
  revision: string;
};
export interface SearchStore {
  pending(model: string): Promise<{ rows: PendingEmbedding[]; count: number }>;
  save(
    row: PendingEmbedding,
    model: string,
    embedding: number[],
  ): Promise<boolean>;
  match(embedding: number[], model: string): Promise<SearchResult[]>;
  source(type: SearchType, id: string): Promise<SearchSource | null>;
}
const tables = {
  task: "tasks",
  meeting: "meetings",
  vault: "vault_items",
  lecture: "lectures",
};
const fields = {
  task: "id,user_id,title,note",
  meeting: "id,user_id,person_name,subject,date,notes",
  vault: "id,user_id,name,detail,url",
  lecture: "id,user_id,title,summary",
};
function sourceDocument(type: SearchType, item: any): SearchSource | null {
  let title = "",
    content = "";
  if (type === "task" && item.note?.trim()) {
    title = item.title;
    content = `Task: ${title}\nNotes: ${item.note}`;
  }
  if (type === "meeting" && item.notes?.trim()) {
    title = `${item.person_name || ""}: ${item.subject || ""}`;
    content = `Meeting with ${item.person_name || ""} on ${item.date || ""}: ${item.subject || ""}\nNotes: ${item.notes}`;
  }
  if (type === "vault") {
    title = item.name;
    content = [item.name, item.detail, item.url].filter(Boolean).join("\n");
  }
  if (type === "lecture") {
    title = item.title;
    content = `Lecture: ${title}\nSummary: ${item.summary || ""}`;
  }
  if (!content.trim()) return null;
  return readSearchSource({
    sourceType: type,
    sourceId: item.id,
    title: (title || "Untitled").slice(0, 200),
    content: content.slice(0, 500000),
  });
}
export function supabaseSearchStore(
  owner: string,
  authorization: string,
  env: NodeJS.ProcessEnv,
  service: SupabaseClient,
): SearchStore {
  const client = createClient(
    env.SUPABASE_URL || env.VITE_SUPABASE_URL || "",
    env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "",
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return databaseSearchStore(owner, client, service);
}
function databaseSearchStore(
  owner: string,
  client: SupabaseClient,
  service: SupabaseClient,
): SearchStore {
  return {
    async pending(model) {
      const { data, count, error } = await client
        .from("embeddings")
        .select("source_type,source_id,chunk_index,title,content,revision", {
          count: "exact",
        })
        .eq("user_id", owner)
        .or(`embedding.is.null,model.is.null,model.neq.${model}`)
        .order("updated_at", { ascending: true })
        .order("source_id", { ascending: true })
        .order("chunk_index", { ascending: true })
        .limit(16);
      if (error)
        throw new Error(
          "Search index unavailable. Apply the latest SQL migration and enable pgvector.",
        );
      return { rows: data || [], count: count || 0 };
    },
    async save(row, model, embedding) {
      const { data, error } = await service.rpc("save_search_embedding", {
        p_user_id: owner,
        p_source_type: row.source_type,
        p_source_id: row.source_id,
        p_chunk_index: row.chunk_index,
        p_revision: row.revision,
        p_model: model,
        p_embedding: JSON.stringify(embedding),
      });
      if (error) throw new Error("Could not save the search index.");
      return data === true;
    },
    async match(embedding, model) {
      const { data, error } = await client.rpc("match_search_notes", {
        p_embedding: JSON.stringify(embedding),
        p_model: model,
      });
      if (error)
        throw new Error("Search unavailable. Apply the latest SQL migration.");
      return readSearchResults(
        (data || []).map((row: any) => ({
          sourceType: row.source_type,
          sourceId: row.source_id,
          title: row.title,
          content: row.content,
          score: row.score,
        })),
      );
    },
    async source(type, id) {
      const { data, error } = await client
        .from(tables[type])
        .select(fields[type])
        .eq("user_id", owner)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error("Could not open this source.");
      return data ? sourceDocument(type, data) : null;
    },
  };
}
export function createSemanticSearch(
  options: {
    env?: NodeJS.ProcessEnv;
    embedder?: ReturnType<typeof createEmbedder>;
    store?: (owner: string, authorization: string) => SearchStore;
  } = {},
) {
  const claims = new Set<string>();
  const env = options.env || process.env;
  const embedder = options.embedder || createEmbedder({ env });
  let service: SupabaseClient | undefined;
  const enabled =
    !!embedder.config.baseUrl &&
    !!(
      options.store ||
      (env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
        (env.SUPABASE_URL || env.VITE_SUPABASE_URL) &&
        (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY))
    );
  const identity = (req: Request) => {
    const id = (req as any).userId;
    return typeof id === "string" && !id.startsWith("anon:") ? id : null;
  };
  const getService = () =>
    (service ??= createClient(
      env.SUPABASE_URL || env.VITE_SUPABASE_URL || "",
      env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ));
  const store = (owner: string, authorization: string) =>
    options.store
      ? options.store(owner, authorization)
      : supabaseSearchStore(owner, authorization, env, getService());
  const getStore = (req: Request) => {
    const owner = identity(req);
    if (!owner) throw new Error("Sign in to use semantic search.");
    if (!enabled)
      throw new Error(
        "Semantic search needs an embedding provider and server Supabase configuration.",
      );
    if (!req.headers.authorization?.startsWith("Bearer "))
      throw new Error("Sign in to use semantic search.");
    return store(owner, req.headers.authorization);
  };
  const fail = (res: Parameters<RequestHandler>[1], error: unknown) =>
    res
      .status(503)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Search is temporarily unavailable.",
      });
  const status: RequestHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled, dimensions: 1024, model: embedder.config.model });
  };
  const source: RequestHandler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!identity(req))
      return res.status(401).json({ error: "Sign in to open a source." });
    const { type, id } = req.query;
    if (
      !isSearchType(type) ||
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(id)
    )
      return res.status(400).json({ error: "Invalid source." });
    try {
      const result = await getStore(req).source(type, id);
      if (!result)
        return res
          .status(404)
          .json({
            error:
              "This source was deleted, is empty, or is unavailable for this account.",
          });
      res.json(result);
    } catch (error) {
      fail(res, error);
    }
  };
  const prepare =
    (query: boolean): RequestHandler =>
    async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      if (!identity(req))
        return res
          .status(401)
          .json({ error: "Sign in to use semantic search." });
      let term = "";
      if (query) {
        try {
          term = searchQuery(req.body?.query);
        } catch (error) {
          return res.status(400).json({ error: (error as Error).message });
        }
      }
      const owner = identity(req)!;
      if (claims.has(owner))
        return res
          .status(409)
          .json({
            error:
              "Your notes are being indexed or searched. Please retry shortly.",
          });
      claims.add(owner);
      const release = () => {
        claims.delete(owner);
        res.off("close", release);
        res.off("finish", release);
      };
      res.on("close", release);
      res.on("finish", release);
      try {
        const current = getStore(req);
        const pending = await current.pending(embedder.config.space);
        if (!query && !pending.rows.length)
          return res.json({ indexed: 0, pending: 0 });
        (req as any).searchWork = { store: current, pending, query: term };
        next();
      } catch (error) {
        fail(res, error);
      }
    };
  async function processBatch(
    current: SearchStore,
    pending: { rows: PendingEmbedding[]; count: number },
    query: string,
    signal: AbortSignal,
  ) {
    const input = [
      ...(query
        ? [
            `Instruct: Given a question, retrieve relevant personal notes, meeting statements and lecture summaries.\nQuery: ${query}`,
          ]
        : []),
      ...pending.rows.map((row) => `${row.source_type}: ${row.title}\n${row.content}`),
    ];
    if (!input.length)
      return {
        results: [],
        indexed: 0,
        pending: pending.count,
        mode: "semantic" as const,
      };
    const vectors = await embedder.embed(input, signal);
    let indexed = 0;
    for (let i = 0; i < pending.rows.length; i++) {
      signal.throwIfAborted();
      if (
        await current.save(
          pending.rows[i],
          embedder.config.space,
          vectors[i + (query ? 1 : 0)],
        )
      )
        indexed++;
    }
    signal.throwIfAborted();
    const results = query
      ? await current.match(vectors[0], embedder.config.space)
      : [];
    return {
      results,
      indexed,
      pending: Math.max(0, pending.count - indexed),
      mode: "semantic" as const,
    };
  }
  const handler: RequestHandler = async (req, res) => {
    const abort = new AbortController();
    const close = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on("close", close);
    try {
      const work = (req as any).searchWork;
      res.json(
        await processBatch(work.store, work.pending, work.query, abort.signal),
      );
    } catch (error) {
      if (!abort.signal.aborted) fail(res, error);
    } finally {
      res.off("close", close);
    }
  };
  const startWorker = (reserve: (owner: string) => Promise<boolean>) => {
    if (!enabled || options.store) return null;
    const worker = createSearchWorker({
      candidates: async (excluded) => {
        let query = getService()
          .from("embeddings")
          .select("user_id")
          .or(
            `embedding.is.null,model.is.null,model.neq.${embedder.config.space}`,
          )
          .order("updated_at", { ascending: true })
          .limit(100);
        if (excluded.length)
          query = query.not("user_id", "in", `(${excluded.join(",")})`);
        const { data, error } = await query;
        if (error) throw new Error("Search queue unavailable.");
        return [
          ...new Set(
            (data || [])
              .map((row) => String(row.user_id))
              .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
          ),
        ];
      },
      run: async (owner, signal) => {
        if (claims.has(owner)) return "busy";
        claims.add(owner);
        try {
          const current = databaseSearchStore(
            owner,
            getService(),
            getService(),
          );
          const pending = await current.pending(embedder.config.space);
          if (!pending.rows.length) return "busy";
          if (!(await reserve(owner))) return "quota";
          await processBatch(current, pending, "", signal);
          return "done";
        } finally {
          claims.delete(owner);
        }
      },
    });
    void worker.tick();
    return worker;
  };
  return {
    enabled,
    status,
    source,
    startWorker,
    prepareIndex: prepare(false),
    prepareQuery: prepare(true),
    index: handler,
    query: handler,
    async retrieve(
      owner: string,
      authorization: string,
      query: string,
      signal: AbortSignal,
    ) {
      if (!enabled || owner.startsWith("anon:"))
        throw new Error("Semantic search is unavailable.");
      if (claims.has(owner))
        throw new Error("Your notes are being indexed. Please retry shortly.");
      claims.add(owner);
      try {
        const current = store(owner, authorization);
        return await processBatch(
          current,
          await current.pending(embedder.config.space),
          searchQuery(query),
          signal,
        );
      } finally {
        claims.delete(owner);
      }
    },
  };
}
