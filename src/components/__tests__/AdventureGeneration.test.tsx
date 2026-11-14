// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { it, expect, vi } from "vitest";
import Adventures from "../../pages/Adventures";
const z = vi.hoisted(() => ({
  adventures: [],
  generatedAdventures: [],
  adventureGenerationEnabled: true,
  adventureGenerationProgress: "",
  adventureGenerationError: "",
  adventureGenerationPreview: null as any,
  state: { lectures: [{ id: "lecture-1", title: "User lecture title" }] },
  generateAdventure: vi.fn(),
  cancelAdventureGeneration: vi.fn(),
}));
vi.mock("../../context/ZenosContext", () => ({ useZenos: () => z }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("offers owned lectures, progress cancellation and a preview before an exploration link", async () => {
  const element = document.createElement("div"),
    root = createRoot(element);
  const render = () =>
    root.render(
      <MemoryRouter>
        <Adventures />
      </MemoryRouter>,
    );
  try {
    await act(async () => render());
    const select = element.querySelector("select")!;
    await act(async () => {
      select.value = "lecture-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((b) => b.textContent === "Generate adventure")!
        .click();
    });
    expect(z.generateAdventure).toHaveBeenCalledWith({
      lectureId: "lecture-1",
    });
    z.adventureGenerationProgress = "grounding";
    await act(async () => render());
    expect(element.querySelector("[role=status]")?.textContent).toContain(
      "Checking source support",
    );
    await act(async () =>
      Array.from(element.querySelectorAll("button"))
        .find((b) => b.textContent === "Cancel")!
        .click(),
    );
    expect(z.cancelAdventureGeneration).toHaveBeenCalled();
    z.adventureGenerationProgress = "";
    z.adventureGenerationPreview = {
      id: "generated-id",
      topic: "Private topic",
      theme: "forest-academy",
      objectives: ["Grounded objective"],
      missionCount: 3,
    };
    await act(async () => render());
    expect(element.textContent).toContain("Grounded objective");
    expect(
      element.querySelector('a[href="/adventures/generated-id"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
