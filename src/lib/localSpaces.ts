import {
  arrangeSpaceWidgets,
  spaceCode,
  remixCredit,
  initialSpaceCode,
  noSpacePermissions,
  spacePageFromRow,
  spaceSnapshot,
  spaceVersionFromRow,
  type SpaceSnapshot,
  type SpacePage,
  type SpaceVersion,
  type SpaceVersionInfo,
} from "../../shared/space";
const DATABASE = "zenos-spaces";
async function open() {
  if (typeof indexedDB === "undefined")
    throw new Error("Local page storage is unavailable.");
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pages"))
        request.result.createObjectStore("pages", { keyPath: "id" });
      const versions = request.result.objectStoreNames.contains("versions")
        ? request.transaction!.objectStore("versions")
        : request.result.createObjectStore("versions", { keyPath: "id" });
      if (!versions.indexNames.contains("pageId"))
        versions.createIndex("pageId", "pageId");
      if (!versions.indexNames.contains("pageRecent"))
        versions.createIndex("pageRecent", ["pageId", "createdAt", "id"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open local pages."));
    request.onblocked = () =>
      reject(new Error("Close other ZEN OS tabs to update page storage."));
  });
}
export async function listLocalSpaces(): Promise<SpacePage[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("pages", "readonly");
      const req = tx.objectStore("pages").getAll();
      tx.oncomplete = () => {
        try {
          resolve(
            req.result
              .map(spacePageFromRow)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          );
        } catch (error) {
          reject(error);
        }
      };
      tx.onabort = tx.onerror = () =>
        reject(new Error("Could not read local pages."));
    });
  } finally {
    db.close();
  }
}
export async function readLocalSpace(pageId: string): Promise<SpaceSnapshot> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["pages", "versions"], "readonly");
      const req = tx.objectStore("pages").get(pageId);
      let snapshot: SpaceSnapshot;
      req.onsuccess = () => {
        try {
          const page = spacePageFromRow(req.result);
          const version = tx.objectStore("versions").get(page.currentVersionId);
          version.onsuccess = () => {
            try {
              snapshot = spaceSnapshot({ page, version: version.result });
            } catch {
              tx.abort();
            }
          };
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(snapshot);
      tx.onabort = tx.onerror = () =>
        reject(new Error("Page not found or local storage is unavailable."));
    });
  } finally {
    db.close();
  }
}
export async function localSpaceHistory(
  pageId: string,
  offset = 0,
): Promise<SpaceVersionInfo[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("versions", "readonly");
      const range = IDBKeyRange.bound(
        [pageId, "", ""],
        [pageId, "\uffff", "\uffff"],
      );
      const req = tx
        .objectStore("versions")
        .index("pageRecent")
        .openCursor(range, "prev");
      const rows: SpaceVersionInfo[] = [];
      let skipped = false;
      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (!cursor) return;
          if (offset && !skipped) {
            skipped = true;
            cursor.advance(offset);
            return;
          }
          rows.push(spaceVersionFromRow(cursor.value, true));
          if (rows.length < 30) cursor.continue();
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(rows);
      tx.onabort = tx.onerror = () =>
        reject(new Error("Could not read page history."));
    });
  } finally {
    db.close();
  }
}
export async function localSpaceVersion(
  pageId: string,
  id: string,
): Promise<SpaceVersion> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("versions", "readonly");
      const req = tx.objectStore("versions").get(id);
      tx.oncomplete = () => {
        try {
          const row = spaceVersionFromRow(req.result);
          if (row.pageId !== pageId) throw new Error("Version not found.");
          resolve(row);
        } catch (error) {
          reject(error);
        }
      };
      tx.onabort = tx.onerror = () =>
        reject(new Error("Could not read page version."));
    });
  } finally {
    db.close();
  }
}
/** Both stores commit together; version history is append-only. */
export async function changeLocalSpace(
  pageId: string,
  operation: (
    page: SpacePage | null,
    getVersion: (
      id: string,
      done: (version: SpaceVersion | null) => void,
    ) => void,
    save: (snapshot: SpaceSnapshot) => void,
  ) => void,
): Promise<SpaceSnapshot> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["pages", "versions"], "readwrite");
      const pages = tx.objectStore("pages"),
        versions = tx.objectStore("versions");
      const req = pages.get(pageId);
      let result: SpaceSnapshot;
      let reason = "Could not save this page. Check browser storage.";
      const fail = (error: unknown) => {
        reason = error instanceof Error ? error.message : reason;
        tx.abort();
      };
      req.onsuccess = () => {
        try {
          operation(
            req.result ? spacePageFromRow(req.result) : null,
            (id, done) => {
              const read = versions.get(id);
              read.onsuccess = () => {
                try {
                  done(read.result ? spaceVersionFromRow(read.result) : null);
                } catch (error) {
                  fail(error);
                }
              };
            },
            (snapshot) => {
              result = spaceSnapshot(snapshot);
              if (result.page.id !== pageId) throw new Error("Invalid page.");
              pages.put(result.page);
              versions.put(result.version);
            },
          );
        } catch (error) {
          fail(error);
        }
      };
      tx.oncomplete = () =>
        result
          ? resolve(result)
          : reject(new Error("Page change was not saved."));
      tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally {
    db.close();
  }
}
export async function createLocalSpace(
  id: string,
  slug: string,
  title: string,
  versionId: string,
  remix?: {code:import("../../shared/space").SpaceCode;credit:import("../../shared/space").RemixCredit},
) {
  // Slug collision check and creation must share the same transaction.
  const db = await open();
  try {
    return await new Promise<SpaceSnapshot>((resolve, reject) => {
      const tx = db.transaction(["pages", "versions"], "readwrite");
      const pages = tx.objectStore("pages");
      const req = pages.getAll();
      let result: SpaceSnapshot;
      let reason = "Could not create this page.";
      req.onsuccess = () => {
        try {
          const existing = req.result.find((row) => row.id === id);
          if (existing) throw new Error("Page already exists.");
          if (req.result.some((row) => row.slug === slug))
            throw new Error("That page address is already in use.");
          const createdAt = new Date().toISOString();
          const page = spacePageFromRow({
            id,
            slug,
            title,
            remixSource: remix ? remixCredit(remix.credit) : null,
            currentVersionId: versionId,
            permissions: noSpacePermissions(),
            createdAt,
            updatedAt: createdAt,
          });
          const version: SpaceVersion = {
            ...(remix ? spaceCode(remix.code) : initialSpaceCode),
            id: versionId,
            pageId: id,
            kind: "initial",
            prompt: "",
            reply: "",
            explanation: remix ? "Copied a public gallery page into your private space with credit to its author." : "",
            model: "",
            restoredFrom: null,
            createdAt,
          };
          result = spaceSnapshot({ page, version });
          pages.add(page);
          tx.objectStore("versions").add(version);
        } catch (error) {
          reason = error instanceof Error ? error.message : reason;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally {
    db.close();
  }
}

export async function changeLocalSpaceWidget(id: string, action: import('../../shared/space').SpaceWidgetAction) {
  const db = await open();
  try {
    return await new Promise<SpacePage[]>((resolve,reject) => {
      const tx = db.transaction('pages','readwrite');
      const store = tx.objectStore('pages');
      const request = store.getAll();
      let pages: SpacePage[];
      let failure: unknown;
      request.onsuccess = () => {
        try {
          pages = arrangeSpaceWidgets(request.result.map(spacePageFromRow),id,action);
          pages.forEach(page => store.put(page));
        } catch(error) { failure=error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(pages);
      tx.onabort = tx.onerror = () => reject(failure || new Error('Could not save dashboard layout.'));
    });
  } finally { db.close(); }
}
