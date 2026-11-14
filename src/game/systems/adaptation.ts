import type { AdventureSpec } from "../spec";
import {
  emptyPuzzleStats,
  type PuzzleStats,
  type CheckResult,
} from "../mechanics/types";
import {
  normalizeProgress,
  questStatus,
  transitionQuest,
  type QuestProgress,
} from "./quest";
export type MissionEvidence = PuzzleStats & { correct: boolean };
/** Learning evidence never includes time, XP or completion percentage. */
export type LearningEvidence = {
  missions: Record<string, MissionEvidence>;
  explanations: Record<string, number>;
};
export function missionEvidence(learning: LearningEvidence, id: string) {
  return Object.hasOwn(learning.missions, id)
    ? learning.missions[id]
    : undefined;
}
const explanationCount = (learning: LearningEvidence, id: string) =>
  Object.hasOwn(learning.explanations, id) ? learning.explanations[id] : 0;
/** Engagement is descriptive activity, never evidence of knowledge. */
export type EngagementMetrics = {
  progress: QuestProgress;
  activeSeconds: number;
  lastActiveAt: number | null;
};
export type AdventureRun = {
  learning: LearningEvidence;
  engagement: EngagementMetrics;
};
export const emptyAdventureRun = (): AdventureRun => ({
  learning: { missions: {}, explanations: {} },
  engagement: {
    progress: { accepted: [], completed: [] },
    activeSeconds: 0,
    lastActiveAt: null,
  },
});
export type Mastery = {
  conceptId: string;
  name: string;
  attempts: number;
  correctFirstTry: number;
  retries: number;
  hintsUsed: number;
  solved: number;
  score: number | null;
  needsPractice: boolean;
};
export function conceptMastery(
  spec: AdventureSpec,
  learning: LearningEvidence,
): Mastery[] {
  return spec.concepts.map((concept) => {
    const objectiveIds = spec.objectives
      .filter((o) => o.conceptIds.includes(concept.id))
      .map((o) => o.id);
    const missions = allMissions(spec).filter((m) =>
      objectiveIds.includes(m.objectiveId),
    );
    const evidence = missions
      .map((m) => missionEvidence(learning, m.id))
      .filter((s) => s && s.attempts > 0);
    const attempts = evidence.reduce((n, s) => n + s.attempts, 0),
      solved = evidence.filter((s) => s.correct).length;
    const score = evidence.length
      ? Math.round(
          (100 *
            evidence.reduce(
              (n, s) =>
                n +
                (s.correct
                  ? Math.max(
                      0.2,
                      1 - 0.15 * s.wrongAttempts - 0.2 * s.hintLevel,
                    )
                  : 0),
              0,
            )) /
            evidence.length,
        )
      : null;
    return {
      conceptId: concept.id,
      name: concept.name,
      attempts,
      solved,
      correctFirstTry: evidence.filter((s) => s.correct && s.attempts === 1)
        .length,
      retries: evidence.reduce((n, s) => n + s.wrongAttempts, 0),
      hintsUsed: evidence.reduce((n, s) => n + s.hintLevel, 0),
      score,
      needsPractice:
        score !== null && score < 70 && (attempts >= 2 || solved > 0),
    };
  });
}
export function allMissions(spec: AdventureSpec): AdventureSpec["missions"] {
  return [
    ...spec.missions,
    ...(spec.practiceVariants ?? []).map((v) => {
      const base = spec.missions.find((m) => m.id === v.missionId)!;
      return {
        ...base,
        id: v.id,
        title: v.title,
        puzzle: v.puzzle,
        sources: v.sources,
        unlocks: undefined,
        xp: 0,
        prerequisites: [...base.prerequisites],
      };
    }),
  ];
}
export function practiceMissionIds(
  spec: AdventureSpec,
  learning: LearningEvidence,
) {
  const weak = conceptMastery(spec, learning)
    .filter((c) => c.needsPractice)
    .map((c) => c.conceptId);
  return (spec.practiceVariants ?? [])
    .filter((v) => {
      const m = spec.missions.find((m) => m.id === v.missionId)!;
      const objective = spec.objectives.find((o) => o.id === m.objectiveId)!;
      return (
        objective.conceptIds.some((id) => weak.includes(id)) ||
        !!missionEvidence(learning, v.id)
      );
    })
    .map((v) => v.id);
}
export function adaptiveSpec(
  spec: AdventureSpec,
  learning: LearningEvidence,
): AdventureSpec {
  const unlocked = practiceMissionIds(spec, learning);
  return {
    ...spec,
    missions: allMissions(spec).filter(
      (m) =>
        spec.missions.some((b) => b.id === m.id) || unlocked.includes(m.id),
    ),
  };
}
export function autoHintLevel(wrongAttempts: number, current: number) {
  return Math.min(
    3,
    Math.max(current, wrongAttempts >= 4 ? 3 : wrongAttempts >= 2 ? 2 : 0),
  );
}
export type RunAction =
  | { type: "accept"; missionId: string }
  | { type: "hint"; missionId: string }
  | { type: "answer"; missionId: string; check: CheckResult }
  | { type: "explanation"; conceptId: string }
  | { type: "tick" };
/** Only a trusted verifier may pass an answer check. Callers cannot choose XP/mastery. */
export function applyRunAction(
  spec: AdventureSpec,
  before: AdventureRun,
  action: RunAction,
  now = Date.now(),
) {
  const run: AdventureRun = structuredClone(before),
    effective = adaptiveSpec(spec, run.learning);
  let check: CheckResult | undefined,
    xpGranted = 0,
    newlyUnlocked: string[] = [],
    missionId: string | null = null;
  const elapsed =
    run.engagement.lastActiveAt === null
      ? 0
      : Math.max(
          0,
          Math.min(30, Math.floor((now - run.engagement.lastActiveAt) / 1000)),
        );
  run.engagement.activeSeconds = Math.min(
    864000,
    run.engagement.activeSeconds + elapsed,
  );
  run.engagement.lastActiveAt = now;
  if (action.type === "explanation") {
    if (!spec.concepts.some((c) => c.id === action.conceptId))
      throw new Error("Unknown concept.");
    run.learning.explanations[action.conceptId] = Math.min(
      3,
      explanationCount(run.learning, action.conceptId) + 1,
    );
    for (const mission of effective.missions) {
      const objective = spec.objectives.find(
        (o) => o.id === mission.objectiveId,
      )!;
      if (
        objective.conceptIds.includes(action.conceptId) &&
        !missionEvidence(run.learning, mission.id)?.correct
      ) {
        const old = missionEvidence(run.learning, mission.id) ?? {
          ...emptyPuzzleStats(),
          correct: false,
        };
        run.learning.missions[mission.id] = {
          ...old,
          hintLevel: Math.max(2, old.hintLevel),
        };
      }
    }
  } else if (action.type !== "tick") {
    const mission = effective.missions.find((m) => m.id === action.missionId);
    if (!mission) throw new Error("Mission is locked.");
    const status = questStatus(effective, run.engagement.progress, mission.id),
      old = missionEvidence(run.learning, mission.id) ?? {
        ...emptyPuzzleStats(),
        correct: false,
      };
    if (action.type === "accept") {
      if (status !== "available" && status !== "active")
        throw new Error("Mission is locked or complete.");
      const result = transitionQuest(
        effective,
        run.engagement.progress,
        action,
      );
      run.engagement.progress = result.progress;
      run.learning.missions[mission.id] = old;
    } else {
      if (status !== "active") throw new Error("Mission is not active.");
      if (action.type === "hint")
        run.learning.missions[mission.id] = {
          ...old,
          hintLevel: Math.max(
            old.hintLevel,
            Math.min(3, Math.min(old.wrongAttempts + 1, old.hintLevel + 1)),
          ),
        };
      else {
        check = action.check;
        if (check.code !== "invalid") {
          const wrongAttempts = Math.min(
            1000,
            old.wrongAttempts + (check.correct ? 0 : 1),
          );
          const stats = {
            ...old,
            attempts: Math.min(1000, old.attempts + 1),
            wrongAttempts,
            correct: check.correct,
            hintLevel: autoHintLevel(wrongAttempts, old.hintLevel),
          };
          run.learning.missions[mission.id] = stats;
          if (check.correct) {
            const result = transitionQuest(effective, run.engagement.progress, {
              type: "complete",
              missionId: mission.id,
            });
            run.engagement.progress = result.progress;
            xpGranted = result.xpGranted;
            missionId = mission.id;
            newlyUnlocked = result.newlyUnlocked;
          }
        }
      }
    }
  }
  // Keep already-unlocked practice available even after the estimate improves.
  const after = adaptiveSpec(spec, run.learning);
  run.engagement.progress = normalizeProgress(after, run.engagement.progress);
  return {
    run,
    check,
    xpGranted,
    newlyUnlocked,
    missionId,
    stats:
      "missionId" in action
        ? (missionEvidence(run.learning, action.missionId) ?? {
            ...emptyPuzzleStats(),
            correct: false,
          })
        : undefined,
  };
}
export function alternativeExplanations(
  spec: AdventureSpec,
  conceptId: string,
) {
  const concept = spec.concepts.find((c) => c.id === conceptId);
  if (!concept) return [];
  if (concept.explanations?.length) return concept.explanations;
  const objectives = spec.objectives
    .filter((o) => o.conceptIds.includes(conceptId))
    .map((o) => o.id);
  return [
    ...new Set(
      [
        concept.misconception,
        ...spec.missions
          .filter((m) => objectives.includes(m.objectiveId))
          .flatMap((m) => m.sources.map((s) => s.quote)),
      ].filter((v): v is string => !!v),
    ),
  ].slice(0, 3);
}

/** Browser sample storage is untrusted; rebuild bounded evidence from known IDs. */
export function normalizeAdventureRun(
  spec: AdventureSpec,
  input: unknown,
): AdventureRun {
  const raw = input as any,
    run = emptyAdventureRun(),
    bounded = (n: unknown, max = 1000) =>
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(0, Math.min(max, Math.floor(n)))
        : 0;
  for (const m of allMissions(spec)) {
    const old = raw?.learning?.missions?.[m.id];
    if (!old || typeof old !== "object") continue;
    const attempts = bounded(old.attempts),
      wrongAttempts = Math.min(attempts, bounded(old.wrongAttempts));
    run.learning.missions[m.id] = {
      attempts,
      wrongAttempts,
      hintLevel: bounded(old.hintLevel, 3),
      correct: old.correct === true && attempts > wrongAttempts,
    };
  }
  for (const c of spec.concepts) {
    const n = bounded(raw?.learning?.explanations?.[c.id], 3);
    if (n) run.learning.explanations[c.id] = n;
  }
  run.engagement.progress = normalizeProgress(
    adaptiveSpec(spec, run.learning),
    raw?.engagement?.progress,
  );
  run.engagement.activeSeconds = bounded(
    raw?.engagement?.activeSeconds,
    864000,
  );
  run.engagement.lastActiveAt = null;
  return run;
}
