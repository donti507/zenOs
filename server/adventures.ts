import express, { type RequestHandler } from "express";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractAdventurePdf, type SourceSection } from "./adventurePdf";
import { generateAdventureSpec } from "./adventureGeneration";
import { describeConfigProblem, loadLLMConfig } from "./llm";
export const ADVENTURE_PUBLIC_COLUMNS =
  "id,user_id,title,lecture_id,spec,source_refs,status,created_at";
export function createAdventures(
  options: {
    db?: any;
    generate?: typeof generateAdventureSpec;
    pdf?: typeof extractAdventurePdf;
    ready?: boolean;
  } = {},
) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db =
      options.db ??
      (url && key
        ? createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null),
    ready = options.ready ?? !!(db && !describeConfigProblem(loadLLMConfig()));
  const jobs = new WeakMap<
      object,
      {
        sources: SourceSection[];
        lectureId: string | null;
        signal: AbortSignal;
      }
    >(),
    owners = new Set<string>();
  const signed: RequestHandler = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const uid = (req as any).userId;
    if (!uid || uid.startsWith("anon:"))
      return res.status(401).json({ error: "Sign in to generate adventures." });
    if (!ready)
      return res
        .status(503)
        .json({ error: "Adventure generation is unavailable." });
    next();
  };
  const acquire: RequestHandler = (req, res, next) => {
    const uid = (req as any).userId;
    if (owners.has(uid) || owners.size >= 4)
      return res.status(429).json({ error: "Adventure generation is busy." });
    owners.add(uid);
    const release = () => owners.delete(uid);
    res.once("finish", release);
    res.once("close", release);
    next();
  };
  const body = express.Router();
  body.use(
    express.json({ limit: "4kb" }),
    express.raw({ type: "application/pdf", limit: "10mb" }),
  );
  body.use((err: any, _req: any, res: any, _next: any) =>
    res
      .status(err.status === 413 ? 413 : 400)
      .json({ error: "Invalid source or file too large." }),
  );
  const prepare: RequestHandler = async (req, res, next) => {
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(180000),
    ]);
    try {
      let sources: SourceSection[],
        lectureId: string | null = null;
      if (req.is("application/pdf"))
        sources = await (options.pdf ?? extractAdventurePdf)(req.body, signal);
      else {
        lectureId = z
          .object({ lectureId: z.string().uuid() })
          .strict()
          .parse(req.body).lectureId;
        const { data, error } = await db
          .from("lectures")
          .select("id,summary,key_points,flashcards")
          .eq("id", lectureId)
          .eq("user_id", (req as any).userId)
          .abortSignal(signal)
          .maybeSingle();
        if (error) throw new Error();
        if (!data) return res.status(404).json({ error: "Lecture not found." });
        const row = z
          .object({
            summary: z.string().max(4000),
            key_points: z.array(z.string().max(500)).max(20),
            flashcards: z
              .array(
                z.object({
                  question: z.string().max(300),
                  answer: z.string().max(1000),
                }),
              )
              .max(10),
          })
          .passthrough()
          .parse(data);
        sources = [
          { ref: "summary", text: row.summary },
          ...row.key_points.map((text, i) => ({
            ref: `key point ${i + 1}`,
            text,
          })),
          ...row.flashcards.map((c, i) => ({
            ref: `flashcard ${i + 1}`,
            text: c.question + "\n" + c.answer,
          })),
        ];
      }
      if (!sources.some((s) => s.text.trim())) throw new Error();
      jobs.set(req, { sources, lectureId, signal });
      next();
    } catch {
      if (!signal.aborted)
        res
          .status(400)
          .json({
            error:
              "Use a readable, unencrypted PDF up to 10 MB and 40 pages, or an existing lecture.",
          });
      else if (!res.destroyed)
        res.status(408).json({ error: "Source processing timed out." });
    }
  };
  const generate: RequestHandler = async (req, res) => {
    const job = jobs.get(req);
    if (!job) return res.status(400).end();
    res.type("application/x-ndjson");
    res.set("X-Accel-Buffering", "no");
    res.flushHeaders();
    const write = (v: unknown) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(JSON.stringify(v) + "\n");
    };
    const heartbeat = setInterval(() => write({ type: "heartbeat" }), 10000);
    try {
      const generated = await (options.generate ?? generateAdventureSpec)(
        job.sources,
        job.signal,
        (stage) => write({ type: "progress", stage }),
      );
      job.signal.throwIfAborted();
      write({ type: "progress", stage: "saving" });
      const row = {
        id: randomUUID(),
        user_id: (req as any).userId,
        title: generated.spec.title,
        lecture_id: job.lectureId,
        ...generated,
        status: "ready",
      };
      const { error } = await db
        .from("adventures")
        .insert(row)
        .abortSignal(job.signal);
      if (error) throw new Error();
      write({
        type: "ready",
        adventure: { id: row.id, title: row.title },
        preview: {
          topic: row.title,
          objectives: row.spec.objectives.map((o) => o.text),
          theme: row.spec.theme,
          missionCount: row.spec.missions.length,
        },
      });
    } catch {
      write({
        type: "error",
        error:
          "Could not generate a grounded adventure. Try clearer source material.",
      });
    } finally {
      clearInterval(heartbeat);
      jobs.delete(req);
      res.end();
    }
  };
  const list: RequestHandler = async (req, res) => {
    try {
      const { data, error } = await db
        .from("adventures")
        .select("id,title,created_at")
        .eq("user_id", (req as any).userId)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error();
      res.json({ adventures: data });
    } catch {
      res.status(503).json({ error: "Could not load adventures." });
    }
  };
  const read: RequestHandler = async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      return res.status(404).end();
    try {
      const { data, error } = await db
        .from("adventures")
        .select(ADVENTURE_PUBLIC_COLUMNS)
        .eq("id", req.params.id)
        .eq("user_id", (req as any).userId)
        .eq("status", "ready")
        .maybeSingle();
      if (error) throw new Error();
      if (!data) return res.status(404).end();
      const { answers: _, ...safe } = data;
      res.json(safe);
    } catch {
      res.status(503).json({ error: "Could not load adventure." });
    }
  };
  return {
    signed,
    acquire,
    body,
    prepare,
    generate,
    list,
    read,
    status: ((_req, res) => {
      res.set("Cache-Control", "no-store").json({ enabled: ready });
    }) as RequestHandler,
  };
}
