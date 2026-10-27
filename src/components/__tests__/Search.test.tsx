// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import Search from "../../pages/Search";
import Markdown from "../ui/Markdown";
import { searchSourceFooter } from "../../../server/danteSearch";
const source = {
  sourceType: "meeting" as const,
  sourceId: "10000000-0000-0000-0000-000000000001",
  title: "Alex: Launch",
  content: "Alex said Friday.",
  score: 0.9,
};
const query = vi.fn(async () => ({
  results: [source],
  pending: 0,
  mode: "text",
}));
const open = vi.fn(async () => source);
vi.mock("../../context/ZenosContext", () => ({
  useZenos: () => ({
    state: { tasks: [] },
    user: { id: "local" },
    isOffline: true,
    searchEnabled: true,
    searchIndexPending: 0,
    searchIndexError: null,
    searchNotes: query,
    getSearchSource: open,
    indexNotes: vi.fn(),
    setEditTaskId: vi.fn(),
    setShowModal: vi.fn(),
  }),
}));
it("opens citations and permits a new search from a source URL without aborting it", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter
          initialEntries={["/search?type=meeting&id=" + source.sourceId]}
        >
          <Search />
        </MemoryRouter>,
      ),
    );
    expect(host.textContent).toContain("Alex said Friday.");
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Alex launch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(query).toHaveBeenCalledWith("Alex launch", expect.any(AbortSignal));
    expect(host.querySelector('[aria-label="Search results"]')).not.toBeNull();
    const link = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === "Alex: Launch",
    )!;
    await act(async () => link.click());
    expect(
      host.querySelector('[aria-label="Search source"]')?.textContent,
    ).toContain("Alex said Friday.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("renders server-generated source links safely and preserves plain text instead of executing HTML", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <Markdown
            text={"<script>alert(1)</script>" + searchSourceFooter([source])}
          />
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "/search?type=meeting&id=" + source.sourceId,
    );
    expect(host.querySelector("a")?.textContent).toBe("Open source");
  } finally {
    await act(async () => root.unmount());
  }
});
