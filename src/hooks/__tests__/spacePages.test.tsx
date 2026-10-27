// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useSpacePages } from "../useSpacePages";
vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(() => {
      throw new Error("No cloud calls in local mode");
    }),
    from: vi.fn(() => {
      throw new Error("No cloud calls in local mode");
    }),
  },
}));
let root: Root;
let api: ReturnType<typeof useSpacePages>;
const token = async () => null;
function Harness({ owner = "local" }: { owner?: string }) {
  api = useSpacePages({
    ownerId: owner,
    isOffline: true,
    getToken: token,
    isCurrent: () => true,
  });
  return null;
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  await new Promise<void>((resolve) => {
    indexedDB.deleteDatabase("zenos-spaces").onsuccess = () => resolve();
  });
  root = createRoot(document.createElement("div"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        draft: { html: "<main>Timer</main>", css: "", js: "", reply: "Done", explanation: "Added a heading so the page has a clear title." },
      }),
    ),
  );
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("persists every AI edit, resets permissions, restores old code as a new save point and retains history", async () => {
  let initial: any;
  await act(async () => {
    initial = await api.createSpacePage("Study", "study");
  });
  expect(api.spacePages).toHaveLength(1);
  let granted: any;
  await act(async () => {
    granted = await api.setSpacePermissions(initial, {
      tasks: true,
      events: false,
    });
  });
  initial = { ...initial, page: granted };
  expect(
    await api.checkSpaceAccess(initial.page.id, initial.version.id, "tasks"),
  ).toBe(true);
  let edited: any;
  const id = crypto.randomUUID();
  await act(async () => {
    edited = await api.editSpacePage(
      initial,
      "Build timer",
      "allowed",
      id,
      new AbortController().signal,
    );
  });
  expect(edited.version.html).toContain("Timer");
  expect(edited.version.explanation).toContain("clear title");
  expect(edited.version.parentVersionId).toBe(initial.version.id);
  expect(edited.page.permissions.tasks).toBe(false);
  expect(
    await api.checkSpaceAccess(initial.page.id, initial.version.id, "tasks"),
  ).toBe(false);
  let restored: any;
  await act(async () => {
    restored = await api.restoreSpaceVersion(
      edited,
      initial.version.id,
      crypto.randomUUID(),
    );
  });
  expect(restored.version.html).toContain("Your space");
  expect(restored.version.kind).toBe("restore");
  expect(restored.version.parentVersionId).toBe(edited.version.id);
  expect(restored.version.explanation).toContain("Restored");
  expect((await api.readSpaceVersion(initial.page.id, edited.version.id)).explanation).toBe(edited.version.explanation);
  expect(await api.spaceHistory(initial.page.id)).toHaveLength(3);
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => {
    expect((await api.loadSpacePage("study")).version.id).toBe(
      restored.version.id,
    );
  });
});
it("rejects duplicate slugs and stale versions, including permission grants", async () => {
  let initial: any;
  await act(async () => {
    initial = await api.createSpacePage("Study", "study");
  });
  await act(async () => {
    await expect(api.createSpacePage("Duplicate", "study")).rejects.toThrow(
      "already in use",
    );
  });
  let edited: any;
  await act(async () => {
    edited = await api.editSpacePage(
      initial,
      "Timer",
      "allowed",
      crypto.randomUUID(),
      new AbortController().signal,
    );
  });
  await act(async () => {
    await expect(
      api.setSpacePermissions(initial, { tasks: true, events: true }),
    ).rejects.toThrow("Page changed");
    await expect(
      api.restoreSpaceVersion(initial, initial.version.id, crypto.randomUUID()),
    ).rejects.toThrow("Page changed");
  });
  await act(async () => {
    expect((await api.loadSpacePage("study")).version.id).toBe(
      edited.version.id,
    );
  });
});
it("ignores responses and callbacks retained from a previous account", async () => {
  let initial: any;
  await act(async () => {
    initial = await api.createSpacePage("Study", "study");
  });
  const old = api;
  await act(async () => root.render(<Harness owner="new" />));
  await expect(old.loadSpacePage("study")).rejects.toThrow("account changed");
  await expect(
    old.editSpacePage(
      initial,
      "Timer",
      "allowed",
      crypto.randomUUID(),
      new AbortController().signal,
    ),
  ).rejects.toThrow("account changed");
});
it("retains an AI draft after a storage failure and retries saving without another AI call", async () => {
  let initial: any;
  await act(async () => {
    initial = await api.createSpacePage("Study", "study");
  });
  const original = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (...args: any[]) {
      if (this.name === "pages") throw new Error("Storage quota");
      return original.apply(this, args as any);
    });
  const id = crypto.randomUUID();
  try {
    await act(async () => {
      await expect(
        api.editSpacePage(
          initial,
          "Timer",
          "allowed",
          id,
          new AbortController().signal,
        ),
      ).rejects.toThrow("Storage quota");
    });
  } finally {
    put.mockRestore();
  }
  expect(await api.spaceHistory(initial.page.id)).toHaveLength(1);
  await act(async () => {
    await api.editSpacePage(
      initial,
      "Timer",
      "allowed",
      id,
      new AbortController().signal,
    );
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await api.spaceHistory(initial.page.id)).toHaveLength(2);
});

it("persists pin, resize, order and unpin locally without changing versions or grants",async()=>{
 let first:any,second:any;
 await act(async()=>{first=await api.createSpacePage('One','one');second=await api.createSpacePage('Two','two');});
 await act(async()=>{await api.setSpacePermissions(first,{tasks:true,events:false});});
 await act(async()=>{await api.changeSpaceWidget(first.page.id,'small');await api.changeSpaceWidget(second.page.id,'medium');await api.changeSpaceWidget(second.page.id,'earlier');});
 const order=()=>[...api.spacePages].sort((a,b)=>(a.dashboardOrder??0)-(b.dashboardOrder??0)).map(page=>page.id);
 expect(order()).toEqual([second.page.id,first.page.id]);
 await act(async()=>{await api.changeSpaceWidget(first.page.id,'medium');await api.refreshSpacePages();});
 expect(order()).toEqual([second.page.id,first.page.id]);
 expect(api.spacePages.find(page=>page.id===first.page.id)?.dashboardSize).toBe('medium');
 let loaded:any;await act(async()=>{loaded=await api.loadSpacePage('one');});
 expect(loaded.version.id).toBe(first.version.id);
 expect(loaded.page.permissions.tasks).toBe(true);
 expect(await api.spaceHistory(first.page.id)).toHaveLength(1);
 await expect(api.changeSpaceWidget(first.page.id,'large' as any)).rejects.toThrow('Invalid widget');
 await act(async()=>{await api.changeSpaceWidget(first.page.id,'unpin');await api.refreshSpacePages();});
 expect(api.spacePages.find(page=>page.id===first.page.id)?.dashboardSize).toBeNull();
 const stale=api.changeSpaceWidget;
 await act(async()=>root.render(<Harness owner="other"/>));
 await expect(stale(second.page.id,'unpin')).rejects.toThrow('account changed');
});
