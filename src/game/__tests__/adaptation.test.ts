import { expect, it } from "vitest";
import { lostBinaryKingdom as spec } from "../samples/lost-binary-kingdom";
import {
  adaptiveSpec,
  applyRunAction,
  conceptMastery,
  emptyAdventureRun,
  practiceMissionIds,
  alternativeExplanations,
} from "../systems/adaptation";
const correct = { correct: true, code: "correct" as const },
  wrong = { correct: false, code: "incorrect" as const };
function attempt(
  run: ReturnType<typeof emptyAdventureRun>,
  check: {
    correct: boolean;
    code: "correct" | "incorrect" | "invalid";
  } = wrong,
  missionId = "power-path",
) {
  return applyRunAction(spec, run, { type: "answer", missionId, check }, 1000)
    .run;
}
it("keeps engagement separate and treats no evidence as unknown rather than weak", () => {
  const run = emptyAdventureRun();
  run.engagement = {
    progress: { accepted: [], completed: ["power-path"] },
    activeSeconds: 9000,
    lastActiveAt: 0,
  };
  expect(
    conceptMastery(spec, run.learning).every(
      (c) => c.score === null && !c.needsPractice,
    ),
  ).toBe(true);
  expect(practiceMissionIds(spec, run.learning)).toEqual([]);
  const tick = applyRunAction(spec, run, { type: "tick" }, 60000).run;
  expect(tick.learning).toEqual(run.learning);
  expect(tick.engagement.activeSeconds).toBe(9030);
});
it("escalates hints after two wrong checks and unlocks a stored practice variant, never the next core gate", () => {
  let run = applyRunAction(spec, emptyAdventureRun(), {
    type: "accept",
    missionId: "power-path",
  }).run;
  run = attempt(run);
  expect(run.learning.missions["power-path"].hintLevel).toBe(0);
  expect(practiceMissionIds(spec, run.learning)).toEqual([]);
  run = attempt(run);
  expect(run.learning.missions["power-path"].hintLevel).toBe(2);
  expect(practiceMissionIds(spec, run.learning)).toEqual(["practice-powers"]);
  expect(run.engagement.progress.completed).toEqual([]);
  expect(conceptMastery(spec, run.learning)[0]).toMatchObject({
    attempts: 2,
    retries: 2,
    score: 0,
    needsPractice: true,
  });
});
it("rewards first-try unassisted evidence, discounts assistance and never counts invalid attempts", () => {
  let run = applyRunAction(spec, emptyAdventureRun(), {
    type: "accept",
    missionId: "power-path",
  }).run;
  const invalid = applyRunAction(spec, run, {
    type: "answer",
    missionId: "power-path",
    check: { correct: false, code: "invalid" },
  }).run;
  expect(invalid.learning).toEqual(run.learning);
  expect(conceptMastery(spec, attempt(run, correct).learning)[0]).toMatchObject(
    { score: 100, correctFirstTry: 1 },
  );
  run = applyRunAction(spec, run, {
    type: "hint",
    missionId: "power-path",
  }).run;
  expect(conceptMastery(spec, attempt(run, correct).learning)[0]).toMatchObject(
    { score: 80, correctFirstTry: 1, hintsUsed: 1 },
  );
});
it("practice improves evidence, cannot farm XP and remains available after it unlocks", () => {
  let run = applyRunAction(spec, emptyAdventureRun(), {
    type: "accept",
    missionId: "power-path",
  }).run;
  run = attempt(attempt(run));
  run = applyRunAction(spec, run, {
    type: "accept",
    missionId: "practice-powers",
  }).run;
  const result = applyRunAction(spec, run, {
    type: "answer",
    missionId: "practice-powers",
    check: correct,
  });
  expect(result.xpGranted).toBe(0);
  expect(result.run.engagement.progress.completed).toContain("practice-powers");
  expect(conceptMastery(spec, result.run.learning)[0].score).toBe(50);
  expect(() =>
    applyRunAction(spec, result.run, {
      type: "answer",
      missionId: "practice-powers",
      check: correct,
    }),
  ).toThrow();
  expect(adaptiveSpec(spec, result.run.learning).missions).toHaveLength(4);
});
it("old specs without variants need no LLM, explanations use saved text and count as assistance", () => {
  const old = { ...spec, practiceVariants: undefined };
  let run = applyRunAction(old, emptyAdventureRun(), {
    type: "accept",
    missionId: "power-path",
  }).run;
  run = applyRunAction(old, run, {
    type: "explanation",
    conceptId: "place-values",
  }).run;
  expect(run.learning.missions["power-path"].hintLevel).toBe(2);
  expect(alternativeExplanations(old, "place-values")).toContain(
    spec.concepts[0].misconception,
  );
  expect(practiceMissionIds(old, attempt(attempt(run)).learning)).toEqual([]);
});

it("treats valid IDs such as constructor as data rather than inherited object properties", () => {
  const copy = structuredClone(spec);
  copy.concepts[0].id = "constructor";
  copy.objectives[0].conceptIds = ["constructor"];
  copy.missions[0].id = "prototype";
  copy.missions[1].prerequisites = ["prototype"];
  copy.practiceVariants![0].missionId = "prototype";
  copy.finale.missionIds[0] = "prototype";
  let run = applyRunAction(copy, emptyAdventureRun(), {
    type: "accept",
    missionId: "prototype",
  }).run;
  run = applyRunAction(copy, run, {
    type: "explanation",
    conceptId: "constructor",
  }).run;
  expect(run.learning.explanations.constructor).toBe(1);
  expect(conceptMastery(copy, run.learning)[0].score).toBeNull();
});
