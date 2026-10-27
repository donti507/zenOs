import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  changeLocalSpace,
  createLocalSpace,
  listLocalSpaces,
  localSpaceHistory,
  localSpaceVersion,
  readLocalSpace,
} from "../lib/localSpaces";
import { notifyDanteUsage } from "../lib/usageEvents";
import {
  noSpacePermissions,
  spaceCode,
  spacePageFromRow,
  spacePermissions,
  spaceSlug,
  spaceSnapshot,
  spaceText,
  spaceVersionFromRow,
  SPACE_LIMITS,
  type SpacePage,
  type SpacePermissions,
  type SpaceSnapshot,
  type SpaceVersion,
  type SpaceVersionInfo,
} from "../../shared/space";
type Options = {
  ownerId: string | null;
  isOffline: boolean;
  getToken: () => Promise<string | null>;
  isCurrent: () => boolean;
};
export function useSpacePages(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const sequence = useRef(0);
  const [spacePages, setPages] = useState<SpacePage[]>([]);
  const [spacePagesLoading, setLoading] = useState(false);
  const [spacePagesError, setError] = useState<string | null>(null);
  const drafts = useRef(
    new Map<
      string,
      {
        prompt: string;
        model: string;
        draft: { html: string; css: string; js: string; reply: string };
      }
    >(),
  );
  const current = () =>
    latest.current.ownerId === options.ownerId &&
    latest.current.isOffline === options.isOffline &&
    latest.current.isCurrent();
  const cache = (page: SpacePage) => {
    if (current()) {
      ++sequence.current;
      setLoading(false);
      setPages((rows) =>
        [page, ...rows.filter((row) => row.id !== page.id)].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
    }
  };
  const refreshSpacePages = useCallback(async () => {
    const request = ++sequence.current;
    if (!options.ownerId || !current()) return;
    setLoading(true);
    setError(null);
    try {
      let rows: SpacePage[] = [];
      if (options.isOffline) rows = await listLocalSpaces();
      else
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await supabase
            .from("space_pages")
            .select("*")
            .eq("user_id", options.ownerId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + 99);
          if (error) throw error;
          if (!current() || request !== sequence.current) return;
          rows.push(...(data || []).map(spacePageFromRow));
          if (!data || data.length < 100) break;
        }
      if (current() && request === sequence.current) setPages(rows);
    } catch {
      if (current() && request === sequence.current)
        setError(
          "Could not load My Space. Check storage or apply the latest migration.",
        );
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [options.ownerId, options.isOffline]);
  useEffect(() => {
    setPages([]);
    setError(null);
    setLoading(false);
    drafts.current.clear();
    if (!options.ownerId) return;
    void refreshSpacePages();
    window.addEventListener("focus", refreshSpacePages);
    return () => {
      ++sequence.current;
      drafts.current.clear();
      window.removeEventListener("focus", refreshSpacePages);
    };
  }, [options.ownerId, options.isOffline, refreshSpacePages]);
  const loadSpacePage = useCallback(
    async (slug: string): Promise<SpaceSnapshot> => {
      spaceSlug(slug);
      if (!current()) throw new Error("Your account changed.");
      let snapshot: SpaceSnapshot;
      if (options.isOffline) {
        const page = (await listLocalSpaces()).find((row) => row.slug === slug);
        if (!page) throw new Error("Page not found in this workspace.");
        snapshot = await readLocalSpace(page.id);
      } else {
        const { data, error } = await supabase
          .from("space_pages")
          .select("id")
          .eq("user_id", options.ownerId)
          .eq("slug", slug)
          .single();
        if (error || !data) throw new Error("Page not found in this account.");
        const result = await supabase.rpc("space_current_snapshot", {
          p_page_id: data.id,
        });
        if (result.error || !result.data)
          throw new Error("Could not load this page.");
        snapshot = spaceSnapshot(result.data);
      }
      if (!current()) throw new Error("Your account changed.");
      cache(snapshot.page);
      return snapshot;
    },
    [options.ownerId, options.isOffline],
  );
  const createSpacePage = useCallback(
    async (title: string, slug: string) => {
      if (!current()) throw new Error("Your account changed.");
      title = spaceText(title, 80, "page title");
      slug = spaceSlug(slug);
      const id = crypto.randomUUID(),
        versionId = crypto.randomUUID();
      let snapshot: SpaceSnapshot;
      if (options.isOffline)
        snapshot = await createLocalSpace(id, slug, title, versionId);
      else {
        const { data, error } = await supabase.rpc("create_space_page", {
          p_id: id,
          p_slug: slug,
          p_title: title,
          p_version_id: versionId,
        });
        if (error)
          throw new Error(
            error.code === "23505"
              ? "That page address is already in use."
              : "Could not create the page. Refresh your page list before retrying.",
          );
        snapshot = spaceSnapshot(data);
      }
      if (!current()) throw new Error("Your account changed.");
      cache(snapshot.page);
      return snapshot;
    },
    [options.ownerId, options.isOffline],
  );
  const spaceHistory = useCallback(
    async (pageId: string, offset = 0): Promise<SpaceVersionInfo[]> => {
      if (!current() || !Number.isInteger(offset) || offset < 0)
        throw new Error("Invalid history request.");
      let rows: SpaceVersionInfo[];
      if (options.isOffline) rows = await localSpaceHistory(pageId, offset);
      else {
        const { data, error } = await supabase
          .from("space_page_versions")
          .select("id,page_id,kind,prompt,reply,model,restored_from,created_at")
          .eq("user_id", options.ownerId)
          .eq("page_id", pageId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + 29);
        if (error) throw new Error("Could not load page history.");
        rows = (data || []).map((row) => spaceVersionFromRow(row, true));
      }
      if (!current()) throw new Error("Your account changed.");
      return rows;
    },
    [options.ownerId, options.isOffline],
  );
  const readSpaceVersion = useCallback(
    async (pageId: string, id: string) => {
      if (!current()) throw new Error("Your account changed.");
      let version: SpaceVersion;
      if (options.isOffline) version = await localSpaceVersion(pageId, id);
      else {
        const { data, error } = await supabase
          .from("space_page_versions")
          .select("*")
          .eq("user_id", options.ownerId)
          .eq("page_id", pageId)
          .eq("id", id)
          .single();
        if (error) throw new Error("Could not load this version.");
        version = spaceVersionFromRow(data);
      }
      if (!current()) throw new Error("Your account changed.");
      return version;
    },
    [options.ownerId, options.isOffline],
  );
  const editSpacePage = useCallback(
    async (
      snapshot: SpaceSnapshot,
      prompt: string,
      model: string,
      requestId: string,
      signal: AbortSignal,
    ): Promise<SpaceSnapshot> => {
      if (!current()) throw new Error("Your account changed.");
      prompt = spaceText(prompt, SPACE_LIMITS.prompt, "edit request");
      let draft = drafts.current.get(requestId)?.draft;
      const previous = drafts.current.get(requestId);
      if (previous && (previous.prompt !== prompt || previous.model !== model))
        throw new Error("Use a new request for a different edit.");
      if (!draft) {
        const localHistory = options.isOffline
          ? (await localSpaceHistory(snapshot.page.id)).slice(0, 5).reverse()
          : undefined;
        const token = await options.getToken();
        if (!current() || signal.aborted) throw new Error("Edit cancelled.");
        let response: Response;
        try {
          response = await fetch(`/api/space/pages/${snapshot.page.id}/edit`, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              prompt,
              model,
              requestId,
              expectedVersionId: snapshot.version.id,
              ...(options.isOffline
                ? {
                    current: spaceCode(snapshot.version),
                    history: localHistory,
                  }
                : {}),
            }),
          });
        } finally {
          notifyDanteUsage();
        }
        const data = await response.json().catch(() => ({}));
        if (!current() || signal.aborted) throw new Error("Edit cancelled.");
        if (!response.ok)
          throw new Error(data.error || "Could not edit this page.");
        if (!options.isOffline) {
          const saved = spaceSnapshot(data.snapshot);
          cache(saved.page);
          return saved;
        }
        draft = {
          ...spaceCode(data.draft),
          reply: spaceText(data.draft?.reply, SPACE_LIMITS.reply, "AI reply"),
        };
        if (drafts.current.size >= 20)
          drafts.current.delete(drafts.current.keys().next().value!);
        drafts.current.set(requestId, { prompt, model, draft });
      }
      if (!current() || signal.aborted) throw new Error("Edit cancelled.");
      const generated = draft;
      const saved = await changeLocalSpace(
        snapshot.page.id,
        (page, getVersion, save) => {
          if (!page) throw new Error("Page not found.");
          getVersion(requestId, (cached) => {
            if (cached) {
              if (cached.pageId !== page.id)
                throw new Error("Edit request conflict.");
              getVersion(page.currentVersionId, (version) => {
                if (!version) throw new Error("Version not found.");
                save({ page, version });
              });
              return;
            }
            if (page.currentVersionId !== snapshot.version.id)
              throw new Error("Page changed; refresh before editing.");
            const createdAt = new Date().toISOString();
            save({
              page: {
                ...page,
                currentVersionId: requestId,
                permissions: noSpacePermissions(),
                updatedAt: createdAt,
              },
              version: {
                ...generated,
                id: requestId,
                pageId: page.id,
                kind: "ai",
                prompt,
                model,
                restoredFrom: null,
                createdAt,
              },
            });
          });
        },
      );
      drafts.current.delete(requestId);
      if (!current()) throw new Error("Your account changed.");
      cache(saved.page);
      return saved;
    },
    [options.ownerId, options.isOffline, options.getToken],
  );
  const restoreSpaceVersion = useCallback(
    async (snapshot: SpaceSnapshot, sourceId: string, requestId: string) => {
      if (!current()) throw new Error("Your account changed.");
      let saved: SpaceSnapshot;
      if (options.isOffline)
        saved = await changeLocalSpace(
          snapshot.page.id,
          (page, getVersion, save) => {
            if (!page) throw new Error("Page not found.");
            getVersion(requestId, (cached) => {
              if (cached) {
                if (cached.pageId !== page.id)
                  throw new Error("Restore request conflict.");
                getVersion(page.currentVersionId, (version) => {
                  if (!version) throw new Error("Version not found.");
                  save({ page, version });
                });
                return;
              }
              if (page.currentVersionId !== snapshot.version.id)
                throw new Error("Page changed; refresh before restoring.");
              getVersion(sourceId, (source) => {
                if (!source || source.pageId !== page.id)
                  throw new Error("Version not found.");
                const createdAt = new Date().toISOString();
                save({
                  page: {
                    ...page,
                    currentVersionId: requestId,
                    permissions: noSpacePermissions(),
                    updatedAt: createdAt,
                  },
                  version: {
                    ...source,
                    id: requestId,
                    kind: "restore",
                    prompt: "",
                    reply: "Restored a saved version.",
                    restoredFrom: source.id,
                    createdAt,
                  },
                });
              });
            });
          },
        );
      else {
        const { data, error } = await supabase.rpc("restore_space_version", {
          p_page_id: snapshot.page.id,
          p_expected_version_id: snapshot.version.id,
          p_source_version_id: sourceId,
          p_version_id: requestId,
        });
        if (error)
          throw new Error(
            "Restore was not confirmed. Refresh history before retrying.",
          );
        saved = spaceSnapshot(data);
      }
      if (!current()) throw new Error("Your account changed.");
      cache(saved.page);
      return saved;
    },
    [options.ownerId, options.isOffline],
  );
  const setSpacePermissions = useCallback(
    async (snapshot: SpaceSnapshot, raw: SpacePermissions) => {
      const permissions = spacePermissions(raw);
      if (!current()) throw new Error("Your account changed.");
      let page: SpacePage;
      if (options.isOffline) {
        const saved = await changeLocalSpace(
          snapshot.page.id,
          (existing, getVersion, save) => {
            if (!existing || existing.currentVersionId !== snapshot.version.id)
              throw new Error("Page changed; refresh before granting access.");
            getVersion(existing.currentVersionId, (version) => {
              if (!version) throw new Error("Version not found.");
              save({
                page: {
                  ...existing,
                  permissions,
                  updatedAt: new Date().toISOString(),
                },
                version,
              });
            });
          },
        );
        page = saved.page;
      } else {
        const { data, error } = await supabase.rpc("set_space_permissions", {
          p_page_id: snapshot.page.id,
          p_expected_version_id: snapshot.version.id,
          p_tasks: permissions.tasks,
          p_events: permissions.events,
        });
        if (error)
          throw new Error(
            "Could not change access. Refresh the page and try again.",
          );
        page = spacePageFromRow(data);
      }
      if (!current()) throw new Error("Your account changed.");
      cache(page);
      return page;
    },
    [options.ownerId, options.isOffline],
  );
  const checkSpaceAccess = useCallback(
    async (pageId: string, versionId: string, method: "tasks" | "events") => {
      if (!current() || !["tasks", "events"].includes(method)) return false;
      let allowed = false;
      if (options.isOffline) {
        const page = (await listLocalSpaces()).find((row) => row.id === pageId);
        allowed =
          page?.currentVersionId === versionId &&
          page.permissions[method] === true;
      } else {
        const { data, error } = await supabase.rpc("space_bridge_permission", {
          p_page_id: pageId,
          p_version_id: versionId,
          p_method: method,
        });
        allowed = !error && data === true;
      }
      return current() && allowed;
    },
    [options.ownerId, options.isOffline],
  );
  return {
    spacePages,
    spacePagesLoading,
    spacePagesError,
    refreshSpacePages,
    createSpacePage,
    loadSpacePage,
    spaceHistory,
    readSpaceVersion,
    editSpacePage,
    restoreSpaceVersion,
    setSpacePermissions,
    checkSpaceAccess,
  };
}
