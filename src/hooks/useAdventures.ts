import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeProgress,
  questStatus,
  type QuestProgress,
} from "../game/systems/quest";
import {
  emptyPuzzleStats,
  parsePuzzleAnswer,
  type PuzzleStats,
} from "../game/mechanics/types";
import {
  normalizeAdventureRun,
  missionEvidence,
  adaptiveSpec,
  applyRunAction,
  conceptMastery,
  emptyAdventureRun,
  type AdventureRun,
} from "../game/systems/adaptation";
import type { AdventureSpec } from "../game/spec";
export type AdventureSettings = {
  lowPerformance: boolean;
  reducedMotion: boolean;
};
const KEY = "zenos_adventure_settings_v1",
  SAMPLE = "lost-binary-kingdom";
export const SAMPLE_ADVENTURES = [
  {
    id: SAMPLE,
    title: "The Lost Binary Kingdom",
    description:
      "Explore a quiet kingdom built around binary numbers and logic.",
    missions: 3,
  },
] as const;
type Runs = { scope: string; data: Record<string, AdventureRun> };
export function useAdventures(
  options: {
    ownerId?: string | null;
    isOffline?: boolean;
    workspaceId?: string | null;
    loadGenerated?: (id: string) => Promise<AdventureSpec>;
    getToken?: () => Promise<string | null>;
  } = {},
) {
  const owner =
      (options.isOffline ? "local:" : "cloud:") +
      (options.ownerId || "anonymous") +
      ":" +
      (options.workspaceId || "personal"),
    scopeRef = useRef({ owner, epoch: 0 });
  if (scopeRef.current.owner !== owner)
    scopeRef.current = { owner, epoch: scopeRef.current.epoch + 1 };
  const scope = owner + ":" + scopeRef.current.epoch,
    current = useRef(scope);
  current.current = scope;
  const mounted = useRef(true);
  const fresh = (): Runs => ({ scope, data: {} }),
    [runs, setRuns] = useState<Runs>(fresh),
    runsRef = useRef(runs),
    loaded = useRef<{ scope: string; id: string; spec: AdventureSpec } | null>(
      null,
    ),
    pending = useRef(new Map<string, symbol>()),
    loadTicket = useRef(0),
    specs = useRef<Record<string, AdventureSpec>>({}),
    revisions = useRef<Record<string, number>>({}),
    [error, setError] = useState("");
  const storageKey = "zenos_adventure_sample_v2:" + owner;
  useEffect(() => {
    mounted.current = true;
    runsRef.current = fresh();
    setRuns(runsRef.current);
    loaded.current = null;
    ++loadTicket.current;
    specs.current = {};
    pending.current.clear();
    revisions.current = {};
    setError("");
    if (options.isOffline) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw && raw.length < 100000)
          void import("../game/samples/lost-binary-kingdom")
            .then(({ lostBinaryKingdom: spec }) => {
              if (
                !mounted.current ||
                current.current !== scope ||
                runsRef.current.data[SAMPLE]
              )
                return;
              const run = normalizeAdventureRun(spec, JSON.parse(raw));
              specs.current[SAMPLE] = spec;
              const next = { scope, data: { [SAMPLE]: run } };
              runsRef.current = next;
              setRuns(next);
            })
            .catch(() => {});
      } catch {}
    }
    return () => {
      mounted.current = false;
    };
  }, [scope]);
  const [adventureSettings, setSettings] = useState<AdventureSettings>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        lowPerformance: p?.lowPerformance === true,
        reducedMotion: p?.reducedMotion === true,
      };
    } catch {
      return { lowPerformance: false, reducedMotion: false };
    }
  });
  const setAdventureSettings = useCallback(
    (patch: Partial<AdventureSettings>) =>
      setSettings((previous) => {
        const next = {
          lowPerformance:
            typeof patch.lowPerformance === "boolean"
              ? patch.lowPerformance
              : previous.lowPerformance,
          reducedMotion:
            typeof patch.reducedMotion === "boolean"
              ? patch.reducedMotion
              : previous.reducedMotion,
        };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      }),
    [],
  );
  const available = (id: string) =>
    mounted.current &&
    current.current === scope &&
    loaded.current?.id === id &&
    loaded.current?.scope === scope;
  const state = (id: string) =>
    runsRef.current.scope === scope
      ? (runsRef.current.data[id] ?? emptyAdventureRun())
      : emptyAdventureRun();
  const commit = (id: string, run: AdventureRun) => {
    if (!available(id)) return;
    const next = {
      scope,
      data: {
        ...(runsRef.current.scope === scope ? runsRef.current.data : {}),
        [id]: run,
      },
    };
    runsRef.current = next;
    setRuns(next);
    if (id === SAMPLE && options.isOffline)
      try {
        localStorage.setItem(storageKey, JSON.stringify(run));
      } catch {}
  };
  async function api(
    id: string,
    path: string,
    action?: unknown,
    signal?: AbortSignal,
  ) {
    if (options.isOffline || options.workspaceId || !options.ownerId)
      throw new Error();
    const token = await options.getToken?.();
    if (!token || current.current !== scope || !mounted.current)
      throw new Error();
    const response = await fetch(
      "/api/adventures/" + encodeURIComponent(id) + "/" + path,
      {
        signal,
        method: action ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(action ? { "Content-Type": "application/json" } : {}),
        },
        body: action ? JSON.stringify(action) : undefined,
      },
    );
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!data.run?.learning?.missions || !data.run?.engagement?.progress)
      throw new Error();
    return data;
  }
  const loadAdventure = useCallback(
    async (id: string): Promise<AdventureSpec> => {
      const ticket = ++loadTicket.current;
      const spec =
        id === SAMPLE
          ? (await import("../game/samples/lost-binary-kingdom"))
              .lostBinaryKingdom
          : await options.loadGenerated?.(id);
      if (!spec) throw new Error("Adventure not found.");
      if (
        current.current !== scope ||
        !mounted.current ||
        loadTicket.current !== ticket
      )
        throw new Error("Your account changed.");
      loaded.current = { scope, id, spec };
      specs.current[id] = spec;
      if (id !== SAMPLE) {
        const data = await api(id, "progress");
        if (!available(id)) throw new Error("Your account changed.");
        revisions.current[id] = data.revision ?? 0;
        commit(id, data.run);
      } else if (options.isOffline) {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw && raw.length < 100000) {
            const run = normalizeAdventureRun(spec, JSON.parse(raw));
            commit(id, run);
          }
        } catch {}
      }
      return spec;
    },
    [scope, options.loadGenerated],
  );
  const remote = async (id: string, action: unknown, signal?: AbortSignal) => {
    const data = await api(
      id,
      "actions",
      { ...(action as object), requestId: crypto.randomUUID() },
      signal,
    );
    if (!available(id) || signal?.aborted) return null;
    if ((data.revision ?? 0) < (revisions.current[id] ?? 0)) return null;
    revisions.current[id] = data.revision ?? 0;
    commit(id, data.run);
    return { ...data, progress: data.run.engagement.progress, preview: false };
  };
  const advanceAdventureQuest = useCallback(
    (id: string, action: { type: "accept"; missionId: string }) => {
      if (!available(id) || action.type !== "accept") return null;
      if (id !== SAMPLE) {
        void remote(id, action).catch(() => {
          if (available(id))
            setError("Could not save adventure progress. Please try again.");
        });
        return null;
      }
      const effective = adaptiveSpec(loaded.current!.spec, state(id).learning),
        status = questStatus(
          effective,
          state(id).engagement.progress,
          action.missionId,
        );
      if (status !== "available" && status !== "active") return null;
      const result = applyRunAction(loaded.current!.spec, state(id), action);
      commit(id, result.run);
      return { ...result, progress: result.run.engagement.progress };
    },
    [scope],
  );
  const requestAdventureHint = useCallback(
    (id: string, missionId: string) => {
      if (!available(id)) return null;
      const spec = adaptiveSpec(loaded.current!.spec, state(id).learning);
      if (
        questStatus(spec, state(id).engagement.progress, missionId) !== "active"
      )
        return null;
      if (id !== SAMPLE) {
        void remote(id, { type: "hint", missionId }).catch(() => {
          if (available(id))
            setError("Could not save adventure progress. Please try again.");
        });
        return null;
      }
      const result = applyRunAction(loaded.current!.spec, state(id), {
        type: "hint",
        missionId,
      });
      commit(id, result.run);
      return result.stats;
    },
    [scope],
  );
  const requestAdventureExplanation = useCallback(
    async (id: string, conceptId: string) => {
      if (!available(id)) return false;
      try {
        if (id !== SAMPLE) await remote(id, { type: "explanation", conceptId });
        else {
          const result = applyRunAction(loaded.current!.spec, state(id), {
            type: "explanation",
            conceptId,
          });
          commit(id, result.run);
        }
        return available(id);
      } catch {
        if (available(id))
          setError("Could not save adventure progress. Please try again.");
        return false;
      }
    },
    [scope],
  );
  const startAdventurePractice = useCallback(
    async (id: string, missionId: string) => {
      if (
        !available(id) ||
        !loaded.current!.spec.practiceVariants?.some((v) => v.id === missionId)
      )
        return false;
      const effective = adaptiveSpec(loaded.current!.spec, state(id).learning),
        status = questStatus(
          effective,
          state(id).engagement.progress,
          missionId,
        );
      if (status === "active") return true;
      if (status !== "available") return false;
      try {
        if (id === SAMPLE)
          advanceAdventureQuest(id, { type: "accept", missionId });
        else await remote(id, { type: "accept", missionId });
        return available(id);
      } catch {
        if (available(id))
          setError("Could not save adventure progress. Please try again.");
        return false;
      }
    },
    [scope],
  );
  const tickAdventure = useCallback(
    (id: string) => {
      if (!available(id)) return;
      if (id !== SAMPLE) {
        void remote(id, { type: "tick" }).catch(() => {});
      } else
        commit(
          id,
          applyRunAction(loaded.current!.spec, state(id), { type: "tick" }).run,
        );
    },
    [scope],
  );
  const submitAdventurePuzzle = useCallback(
    async (
      id: string,
      missionId: string,
      input: unknown,
      signal?: AbortSignal,
    ) => {
      if (!available(id) || signal?.aborted) return null;
      const base = loaded.current!.spec,
        spec = adaptiveSpec(base, state(id).learning),
        mission = spec.missions.find((m) => m.id === missionId);
      if (
        !mission ||
        questStatus(spec, state(id).engagement.progress, missionId) !== "active"
      )
        return null;
      const answer = parsePuzzleAnswer(mission.puzzle, input),
        initial =
          missionEvidence(state(id).learning, missionId) ?? emptyPuzzleStats();
      if (!answer)
        return {
          check: { correct: false, code: "invalid" as const },
          stats: initial,
          progress: normalizeProgress(spec, state(id).engagement.progress),
          xpGranted: 0,
          newlyUnlocked: [] as string[],
          missionId: null,
          preview: id === SAMPLE,
        };
      const key = scope + "/" + id + "/" + missionId;
      if (pending.current.has(key)) return null;
      const ticket = Symbol();
      pending.current.set(key, ticket);
      const release = () => {
        if (pending.current.get(key) === ticket) pending.current.delete(key);
      };
      signal?.addEventListener("abort", release, { once: true });
      try {
        if (id !== SAMPLE)
          return await remote(
            id,
            { type: "answer", missionId, answer },
            signal,
          );
        const { verifyLocalSample } =
          await import("../game/samples/local-verifier");
        if (!available(id) || signal?.aborted) return null;
        const check = await verifyLocalSample(missionId, answer);
        if (
          !available(id) ||
          signal?.aborted ||
          questStatus(spec, state(id).engagement.progress, missionId) !==
            "active"
        )
          return null;
        const result = applyRunAction(base, state(id), {
          type: "answer",
          missionId,
          check,
        });
        commit(id, result.run);
        return {
          ...result,
          progress: result.run.engagement.progress,
          preview: true,
        };
      } catch {
        if (!available(id) || signal?.aborted) return null;
        throw new Error("Could not check this puzzle. Please try again.");
      } finally {
        signal?.removeEventListener("abort", release);
        release();
      }
    },
    [scope],
  );
  const data: Record<string, AdventureRun> =
      runs.scope === scope ? runs.data : {},
    adventureProgress = Object.fromEntries(
      Object.entries(data).map(([id, run]) => [id, run.engagement.progress]),
    );
  const adventurePuzzleStats: Record<string, Record<string, PuzzleStats>> = {};
  for (const [id, run] of Object.entries(data)) {
    const stats = Object.fromEntries(
      Object.entries(run.learning.missions)
        .filter(([, s]) => s.attempts || s.hintLevel)
        .map(([m, s]) => [
          m,
          {
            attempts: s.attempts,
            wrongAttempts: s.wrongAttempts,
            hintLevel: s.hintLevel,
          },
        ]),
    );
    if (Object.keys(stats).length) adventurePuzzleStats[id] = stats;
  }

  // Sample estimates are explicitly practice-only; cloud Dante replaces these with server stats.
  const adventureLearningContext = {
    status: "local-practice",
    adventures: SAMPLE_ADVENTURES.map((a) => ({ id: a.id, title: a.title })),
    concepts: Object.entries(data).flatMap(([id, run]) =>
      specs.current[id]
        ? conceptMastery(specs.current[id], run.learning).map((c) => ({
            ...c,
            adventureId: id,
          }))
        : [],
    ),
  };
  return {
    adventures: SAMPLE_ADVENTURES,
    adventureSettings,
    setAdventureSettings,
    loadAdventure,
    adventureProgress,
    adventurePuzzleStats,
    adventureRuns: data,
    adventureRuntimeError: error,
    adventureLearningContext,
    advanceAdventureQuest,
    submitAdventurePuzzle,
    requestAdventureHint,
    requestAdventureExplanation,
    startAdventurePractice,
    tickAdventure,
  };
}
