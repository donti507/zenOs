import { useEffect, useRef, useState, useCallback } from "react";
import type { AdventureSpec } from "../game/spec";
type Preview = {
  topic: string;
  objectives: string[];
  theme: string;
  missionCount: number;
};
export function useAdventureGeneration({
  ownerId,
  isOffline,
  workspaceId,
  getToken,
}: {
  ownerId?: string | null;
  isOffline: boolean;
  workspaceId: string | null;
  getToken: () => Promise<string | null>;
}) {
  const scope = `${ownerId}:${isOffline}:${workspaceId}`,
    epoch = useRef({ scope, n: 0 });
  if (epoch.current.scope !== scope)
    epoch.current = { scope, n: epoch.current.n + 1 };
  const version = epoch.current.n;
  const mounted = useRef(true);
  const [visibleVersion, setVisibleVersion] = useState(version);
  const [enabled, setEnabled] = useState(false),
    [items, setItems] = useState<{ id: string; title: string }[]>([]),
    [progress, setProgress] = useState(""),
    [preview, setPreview] = useState<(Preview & { id: string }) | null>(null),
    [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const allowed = !!ownerId && !isOffline && !workspaceId;
  const current = () =>
    mounted.current && epoch.current.n === version && allowed;
  async function request(path: string, init: RequestInit = {}) {
    const token = await getToken();
    if (!current() || !token) throw new Error();
    return fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  }
  const refresh = useCallback(async () => {
    try {
      const res = await request("/api/adventures");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (current()) setItems(data.adventures ?? []);
    } catch {
      /* Retain existing list on transient failure. */
    }
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    setVisibleVersion(version);
    setEnabled(false);
    setItems([]);
    setPreview(null);
    setError("");
    setProgress("");
    active.current?.abort();
    if (allowed) {
      const abort = new AbortController();
      void fetch("/api/adventures/status", { signal: abort.signal })
        .then((r) => r.json())
        .then((d) => {
          if (current()) {
            setEnabled(d.enabled === true);
            if (d.enabled) void refresh();
          }
        })
        .catch(() => {});
      return () => {
        mounted.current = false;
        abort.abort();
        active.current?.abort();
      };
    }
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [scope]);
  const generateAdventure = async (source: { lectureId: string } | File) => {
    if (!current() || active.current) return;
    const abort = new AbortController();
    active.current = abort;
    setError("");
    setPreview(null);
    setProgress("extracting");
    try {
      if (source instanceof File && source.size > 10 * 1024 * 1024)
        throw new Error();
      const res = await request("/api/adventures/generate", {
        method: "POST",
        signal: abort.signal,
        headers: {
          "Content-Type":
            source instanceof File ? "application/pdf" : "application/json",
        },
        body: source instanceof File ? source : JSON.stringify(source),
      });
      if (!res.ok || !res.body) throw new Error();
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        total = 0,
        ready = false;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 100000) throw new Error();
        buffer += decoder.decode(part.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (!current() || abort.signal.aborted) return;
          if (event.type === "error") throw new Error();
          if (
            event.type === "progress" &&
            [
              "analyzing",
              "generating",
              "validating",
              "grounding",
              "saving",
            ].includes(event.stage)
          )
            setProgress(event.stage);
          if (event.type === "ready") {
            ready = true;
            setPreview({ ...event.preview, id: event.adventure.id });
            void refresh();
          }
        }
      }
      if (!ready) throw new Error();
    } catch {
      if (current() && !abort.signal.aborted)
        setError(
          "Could not generate adventure. Check the source and try again.",
        );
    } finally {
      if (active.current === abort) active.current = null;
      if (current()) setProgress("");
    }
  };
  const loadGeneratedAdventure = useCallback(
    async (id: string): Promise<AdventureSpec> => {
      if (!current()) throw new Error("Adventure unavailable.");
      const res = await request("/api/adventures/" + encodeURIComponent(id));
      if (!res.ok) throw new Error("Adventure unavailable.");
      const row = await res.json();
      const { validateAdventureSpec } = await import("../game/spec");
      if (!current()) throw new Error("Your account changed.");
      return validateAdventureSpec(row.spec);
    },
    [scope],
  );
  return {
    adventureGenerationEnabled:
      allowed && visibleVersion === version && enabled,
    generatedAdventures: allowed && visibleVersion === version ? items : [],
    adventureGenerationProgress:
      allowed && visibleVersion === version ? progress : "",
    adventureGenerationPreview:
      allowed && visibleVersion === version ? preview : null,
    adventureGenerationError:
      allowed && visibleVersion === version ? error : "",
    generateAdventure,
    cancelAdventureGeneration: () => {
      active.current?.abort();
      active.current = null;
      setProgress("");
    },
    loadGeneratedAdventure,
  };
}
