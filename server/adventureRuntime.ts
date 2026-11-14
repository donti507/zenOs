import { createHash } from "node:crypto";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { validateAdventureSpec } from "../src/game/spec";
import {
  adaptiveSpec,
  allMissions,
  applyRunAction,
  conceptMastery,
  emptyAdventureRun,
  type AdventureRun,
} from "../src/game/systems/adaptation";
import { parsePuzzleAnswer, invalidAnswer } from "../src/game/mechanics/types";
import { validateGate } from "../src/game/mechanics/gate";
import { validateSequence } from "../src/game/mechanics/sequence";
import { validateMatch } from "../src/game/mechanics/match";
const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  uuid = z.string().uuid();
const actionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("accept"), missionId: id, requestId: uuid })
    .strict(),
  z
    .object({ type: z.literal("hint"), missionId: id, requestId: uuid })
    .strict(),
  z
    .object({
      type: z.literal("answer"),
      missionId: id,
      answer: z.unknown(),
      requestId: uuid,
    })
    .strict(),
  z
    .object({ type: z.literal("explanation"), conceptId: id, requestId: uuid })
    .strict(),
  z.object({ type: z.literal("tick"), requestId: uuid }).strict(),
]);
export function checkAdventureAnswer(
  spec: ReturnType<typeof validateAdventureSpec>,
  keys: Record<string, any>,
  missionId: string,
  input: unknown,
) {
  const mission = allMissions(spec).find((m) => m.id === missionId);
  if (!mission) throw new Error();
  const answer = parsePuzzleAnswer(mission.puzzle, input);
  if (!answer) return invalidAnswer();
  const key = keys[missionId];
  if (!key || key.type !== mission.puzzle.type) throw new Error();
  if (answer.type === "gate" && mission.puzzle.type === "gate")
    return validateGate(mission.puzzle, answer.value, key.key);
  if (answer.type === "sequence")
    return validateSequence(answer.order, key.order, mission.puzzle.difficulty);
  if (answer.type === "match")
    return validateMatch(answer.pairs, key.pairs, mission.puzzle.difficulty);
  throw new Error();
}
export function createAdventureRuntime(options: { db?: any } = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db =
    options.db ??
    (url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null);
  const body = express.Router();
  body.use(express.json({ limit: "4kb" }));
  body.use((error: any, _req: any, res: any, _next: any) =>
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ error: "Invalid adventure action." }),
  );
  const signed: RequestHandler = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const owner = (req as any).userId;
    if (!owner || owner.startsWith("anon:"))
      return res
        .status(401)
        .json({ error: "Sign in to play saved adventures." });
    if (!db)
      return res
        .status(503)
        .json({ error: "Adventures storage is unavailable." });
    next();
  };
  const owner = (req: any) => req.userId as string;
  async function read(owner: string, adventureId: string, answers = false) {
    const { data, error } = await db
      .from("adventures")
      .select(answers ? "id,spec,answers" : "id,spec")
      .eq("user_id", owner)
      .eq("id", adventureId)
      .eq("status", "ready")
      .maybeSingle();
    if (error) throw new Error();
    if (!data) return null;
    return { ...data, spec: validateAdventureSpec(data.spec) };
  }
  async function progress(owner: string, adventureId: string) {
    const { data, error } = await db
      .from("adventure_progress")
      .select("revision,run,receipts")
      .eq("user_id", owner)
      .eq("adventure_id", adventureId)
      .maybeSingle();
    if (error) throw new Error();
    return data ?? { revision: 0, run: emptyAdventureRun(), receipts: [] };
  }
  const get: RequestHandler = async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).end();
    try {
      const row = await read(owner(req), String(req.params.id));
      if (!row) return res.status(404).end();
      const state = await progress(owner(req), row.id);
      res.json({ run: state.run, revision: state.revision });
    } catch {
      res.status(503).json({ error: "Could not load adventure progress." });
    }
  };
  const act: RequestHandler = async (req, res) => {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success || !uuid.safeParse(req.params.id).success)
      return res.status(400).json({ error: "Invalid adventure action." });
    const action = parsed.data;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(action))
      .digest("hex");
    try {
      const row = await read(
        owner(req),
        String(req.params.id),
        action.type === "answer",
      );
      if (!row) return res.status(404).end();
      for (let attempt = 0; attempt < 4; attempt++) {
        const state = await progress(owner(req), row.id),
          receipt = state.receipts.find((r: any) => r.id === action.requestId);
        if (receipt) {
          if (
            receipt.fingerprint !== fingerprint ||
            receipt.type !== action.type ||
            receipt.target !==
              ("missionId" in action
                ? action.missionId
                : "conceptId" in action
                  ? action.conceptId
                  : "")
          )
            return res.status(409).json({ error: "Action already used." });
          return res.json({
            ...receipt.result,
            run: state.run,
            revision: state.revision,
            xpGranted: 0,
            newlyUnlocked: [],
          });
        }
        let result;
        try {
          const check =
            action.type === "answer"
              ? checkAdventureAnswer(
                  row.spec,
                  row.answers,
                  action.missionId,
                  action.answer,
                )
              : undefined;
          result = applyRunAction(
            row.spec,
            state.run,
            action.type === "answer"
              ? { type: "answer", missionId: action.missionId, check }
              : action,
          );
        } catch {
          return res
            .status(409)
            .json({ error: "This mission is locked or no longer active." });
        }
        const { run, ...publicResult } = result,
          receipts = [
            ...state.receipts,
            {
              id: action.requestId,
              fingerprint,
              type: action.type,
              target:
                "missionId" in action
                  ? action.missionId
                  : "conceptId" in action
                    ? action.conceptId
                    : "",
              result: publicResult,
            },
          ].slice(-64);
        const { data, error } = await db.rpc("commit_adventure_run", {
          p_user_id: owner(req),
          p_adventure_id: row.id,
          p_revision: state.revision,
          p_run: run,
          p_receipts: receipts,
        });
        if (error) throw new Error();
        if (data)
          return res.json({
            ...publicResult,
            run,
            revision: state.revision + 1,
          });
      }
      res.status(409).json({ error: "Progress changed. Please try again." });
    } catch {
      res.status(503).json({
        error: "Could not save adventure progress. Please try again.",
      });
    }
  };
  async function danteStats(userId: string) {
    if (!db || !userId || userId.startsWith("anon:"))
      return { status: "unavailable", concepts: [] };
    const { data, error } = await db
      .from("adventure_progress")
      .select("adventure_id,run")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) return { status: "unavailable", concepts: [] };
    const { data: catalog, error: catalogError } = await db
      .from("adventures")
      .select("id,title")
      .eq("user_id", userId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(30);
    if (catalogError) return { status: "unavailable", concepts: [] };
    const concepts: any[] = [];
    for (const p of data ?? []) {
      const row = await read(userId, p.adventure_id);
      if (row)
        concepts.push(
          ...conceptMastery(row.spec, (p.run as AdventureRun).learning).map(
            (c) => ({ ...c, adventureId: row.id }),
          ),
        );
    }
    return {
      status: "server-verified",
      adventures: catalog ?? [],
      concepts: concepts
        .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
        .slice(0, 30),
    };
  }
  return { signed, body, get, act, danteStats };
}
