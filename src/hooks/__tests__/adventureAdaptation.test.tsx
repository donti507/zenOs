// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { useAdventures } from "../useAdventures";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("persists local evidence/practice, restores Dante weakness context without opening a world and isolates owners", async () => {
  localStorage.clear();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  let ctx: ReturnType<typeof useAdventures>;
  function Harness({ owner = "learner" }: { owner?: string }) {
    ctx = useAdventures({ ownerId: owner, isOffline: true });
    return null;
  }
  let root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await ctx!.loadAdventure("lost-binary-kingdom");
    });
    await act(async () => {
      ctx!.advanceAdventureQuest("lost-binary-kingdom", {
        type: "accept",
        missionId: "power-path",
      });
      for (let i = 0; i < 2; i++)
        await ctx!.submitAdventurePuzzle("lost-binary-kingdom", "power-path", {
          type: "sequence",
          order: [0, 1, 2, 3],
        });
    });
    expect(ctx!.adventureLearningContext.concepts[0]).toMatchObject({
      score: 0,
      retries: 2,
      needsPractice: true,
    });
    expect(
      ctx!.adventurePuzzleStats["lost-binary-kingdom"]["power-path"].hintLevel,
    ).toBe(2);
    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Harness />);
      await vi.dynamicImportSettled();
    });
    expect(ctx!.adventureLearningContext.concepts[0].retries).toBe(2);
    await act(async () => {
      await ctx!.loadAdventure("lost-binary-kingdom");
    });
    await act(async () => {
      expect(
        await ctx!.startAdventurePractice(
          "lost-binary-kingdom",
          "practice-powers",
        ),
      ).toBe(true);
      const result = await ctx!.submitAdventurePuzzle(
        "lost-binary-kingdom",
        "practice-powers",
        { type: "sequence", order: [1, 3, 2, 0] },
      );
      expect(result?.xpGranted).toBe(0);
    });
    expect(ctx!.adventureLearningContext.concepts[0].score).toBe(50);
    await act(async () => root.render(<Harness owner="other" />));
    expect(ctx!.adventureLearningContext.concepts).toEqual([]);
    expect(ctx!.adventureRuns).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
