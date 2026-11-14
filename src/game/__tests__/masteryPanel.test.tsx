// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import ConceptMasteryPanel from "../systems/ConceptMasteryPanel";
import DialogueBox from "../systems/DialogueBox";
import { lostBinaryKingdom as spec } from "../samples/lost-binary-kingdom";
import { applyRunAction, emptyAdventureRun } from "../systems/adaptation";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("separates engagement from evidence, offers stored practice and renders another NPC explanation as text", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    practice = vi.fn(),
    explain = vi.fn(async () => true);
  let run = emptyAdventureRun();
  try {
    run.engagement.activeSeconds = 600;
    await act(async () =>
      root.render(
        <ConceptMasteryPanel spec={spec} run={run} onPractice={practice} />,
      ),
    );
    expect(host.textContent).toContain("Not enough evidence");
    expect(
      host.querySelector('[aria-label="Engagement metrics"]')?.textContent,
    ).toContain("10 min");
    expect(
      host.querySelector('[aria-label="Concept mastery"]')?.textContent,
    ).not.toContain("10 min");
    run = applyRunAction(spec, run, {
      type: "accept",
      missionId: "power-path",
    }).run;
    for (let i = 0; i < 2; i++)
      run = applyRunAction(spec, run, {
        type: "answer",
        missionId: "power-path",
        check: { correct: false, code: "incorrect" },
      }).run;
    await act(async () =>
      root.render(
        <ConceptMasteryPanel spec={spec} run={run} onPractice={practice} />,
      ),
    );
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(practice).toHaveBeenCalledWith("practice-powers");
    await act(async () =>
      root.render(
        <DialogueBox
          spec={spec}
          npcId="byte"
          progress={run.engagement.progress}
          reducedMotion
          onClose={() => {}}
          onQuest={() => {}}
          onExplanation={explain}
        />,
      ),
    );
    const other = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Explain Binary place values another way",
    )!;
    await act(async () => other.click());
    expect(explain).toHaveBeenCalledWith("place-values");
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      spec.concepts[0].misconception,
    );
    expect(document.querySelector("script")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
