import { it, expect, vi } from "vitest";
import { runDanteActions } from "../danteActions";
import { buildSystemPrompt } from "../../../server/prompt";
const lectureId = "11111111-1111-4111-8111-111111111111";
it("validates create/open actions, uses exact IDs and blocks shared-workspace use", async () => {
  const createAdventure = vi.fn(async () => {}),
    openAdventure = vi.fn(async () => {}),
    deps: any = {
      stateRef: { current: { workspaceId: null } },
      createAdventure,
      openAdventure,
    };
  const run = (action: string, data: any) =>
    runDanteActions([{ action, data }], deps);
  expect((await run("create_adventure", { lectureId }))[0].ok).toBe(true);
  expect(createAdventure).toHaveBeenCalledWith(lectureId);
  expect(
    (await run("open_adventure", { id: "lost-binary-kingdom" }))[0].ok,
  ).toBe(true);
  for (const data of [
    { id: "javascript:alert(1)" },
    { id: "../../tokens" },
    { id: lectureId, userId: "other" },
  ])
    expect((await run("open_adventure", data))[0].ok).toBe(false);
  expect((await run("create_adventure", { lectureId: "made-up" }))[0].ok).toBe(
    false,
  );
  deps.stateRef.current.workspaceId = "shared";
  expect((await run("create_adventure", { lectureId }))[0].ok).toBe(false);
  expect(createAdventure).toHaveBeenCalledTimes(1);
});
it("answers weakness questions from bounded learning evidence and never treats time/completion as mastery", () => {
  const prompt = buildSystemPrompt({
    adventureLearning: {
      status: "server-verified",
      concepts: [
        null,
        {
          name: "Binary <script>",
          adventureId: lectureId,
          score: 30,
          retries: 2,
          hintsUsed: 2,
          attempts: 2,
          needsPractice: true,
        },
      ],
    },
  });
  expect(prompt).toContain("Binary \\u003cscript>");
  expect(prompt).toContain("Time, XP and completion are engagement only");
  expect(prompt).toContain("insufficient evidence");
  expect(prompt).toContain("create_adventure");
  expect(prompt).not.toContain("activeSeconds");
  const shared = buildSystemPrompt({
    workspaceId: "shared",
    adventureLearning: {
      status: "server-verified",
      concepts: [{ name: "PRIVATE CONCEPT" }],
    },
  });
  expect(shared).not.toContain("PRIVATE CONCEPT");
});
