// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSemanticSearch } from "../useSemanticSearch";
import type { ZenosState } from "../../types";
let root: Root;
let api: ReturnType<typeof useSemanticSearch>;
let state: ZenosState;
const token = vi.fn(async () => "verified");
function Harness({
  owner = "a",
  offline = false,
  value = state,
}: {
  owner?: string;
  offline?: boolean;
  value?: ZenosState;
}) {
  const ref = useRef(value);
  ref.current = value;
  api = useSemanticSearch({
    ownerId: owner,
    isOffline: offline,
    getToken: token,
    state: value,
    stateRef: ref,
    isCurrent: () => true,
  });
  return null;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  state = {
    tasks: [{ id: "t", title: "Launch", note: "Alex said Friday." }],
    meetings: [
      {
        id: "m",
        personName: "Alex",
        subject: "Launch",
        date: "2026-10-27",
        notes: "Prepare the launch.",
      },
    ],
    vault: [{ id: "v", name: "Roadmap", detail: "Launch plan" }],
    lectures: [
      { id: "l", title: "Launch lecture", summary: "Review the plan." },
    ],
  } as unknown as ZenosState;
  root = createRoot(document.createElement("div"));
  token.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("searches all four local sources without network/provider calls", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await act(async () => root.render(<Harness offline />));
  let result: any;
  await act(async () => {
    result = await api.searchNotes("launch");
  });
  expect(result.mode).toBe("text");
  expect(new Set(result.results.map((row: any) => row.sourceType))).toEqual(
    new Set(["task", "meeting", "vault", "lecture"]),
  );
  expect(await api.getSearchSource("task", "t")).toMatchObject({
    content: "Task: Launch\nNotes: Alex said Friday.",
  });
  expect(request).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled();
});
it("debounces indexing of searchable edits and never spends requests on card review or task-status changes", async () => {
  const request = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith("/status") ? { enabled: true } : { indexed: 1, pending: 0 },
    ),
  );
  vi.stubGlobal("fetch", request);
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(
    request.mock.calls.filter(([url]) => url.endsWith("/index")),
  ).toHaveLength(1);
  await act(async () =>
    root.render(
      <Harness
        value={{
          ...state,
          tasks: state.tasks.map((row) => ({ ...row, status: "done" })),
          lectures: state.lectures?.map((row) => ({
            ...row,
            flashcards: [{ question: "Q", answer: "A", known: true }],
          })),
        }}
      />,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(
    request.mock.calls.filter(([url]) => url.endsWith("/index")),
  ).toHaveLength(1);
  await act(async () =>
    root.render(
      <Harness
        value={{
          ...state,
          tasks: state.tasks.map((row) => ({
            ...row,
            note: "Alex said Monday.",
          })),
        }}
      />,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(
    request.mock.calls.filter(([url]) => url.endsWith("/index")),
  ).toHaveLength(2);
});
it("drops old-account query responses and unsubscribes scheduled indexing on sign-out", async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn(async (url: string) =>
    url === "/api/search"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json({ enabled: true, indexed: 0, pending: 0 }),
  );
  vi.stubGlobal("fetch", request);
  await act(async () => root.render(<Harness />));
  const old = api;
  let failure: unknown;
  let running!: Promise<unknown>;
  await act(async () => {
    running = old.searchNotes("launch").catch((error) => {
      failure = error;
    });
  });
  await act(async () => root.render(<Harness owner="b" />));
  await act(async () => {
    finish(Response.json({ results: [], pending: 99 }));
    await running;
  });
  expect((failure as Error).message).toContain("account changed");
  expect(api.searchIndexPending).toBe(0);
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(request.mock.calls.some(([url]) => url.endsWith("/index"))).toBe(
    false,
  );
});
