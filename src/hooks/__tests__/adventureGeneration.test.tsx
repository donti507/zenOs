// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { useAdventureGeneration } from "../useAdventureGeneration";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("never fetches in local/shared scope and clears private results across account changes", async () => {
  const element = document.createElement("div"),
    root = createRoot(element);
  let api: ReturnType<typeof useAdventureGeneration>;
  const getToken = async () => "token";
  function Harness({
    owner = "a",
    offline = false,
    workspace = null,
  }: {
    owner?: string;
    offline?: boolean;
    workspace?: string | null;
  }) {
    api = useAdventureGeneration({
      ownerId: owner,
      isOffline: offline,
      workspaceId: workspace,
      getToken,
    });
    return null;
  }
  let finish: (v: unknown) => void = () => {};
  const fetcher = vi.fn(async (path: string) =>
    path.endsWith("/status")
      ? { json: async () => ({ enabled: true }) }
      : path === "/api/adventures"
        ? { ok: true, json: () => new Promise((r) => (finish = r)) }
        : { ok: true, body: new ReadableStream({ start() {} }) },
  );
  vi.stubGlobal("fetch", fetcher);
  try {
    await act(async () => root.render(<Harness offline />));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness workspace="shared" />));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    expect(api!.adventureGenerationEnabled).toBe(true);
    await act(async () => {
      finish({ adventures: [{ id: "private-id", title: "Private title" }] });
    });
    expect(api!.generatedAdventures).toHaveLength(1);
    await act(async () => root.render(<Harness owner="b" />));
    expect(api!.generatedAdventures).toEqual([]);
    await act(async () => root.render(<Harness offline />));
    expect(api!.adventureGenerationEnabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
