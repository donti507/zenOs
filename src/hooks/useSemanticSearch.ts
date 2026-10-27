import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  isSearchType,
  readSearchResults,
  readSearchSource,
  searchQuery,
  textSearch,
  type SearchResponse,
  type SearchType,
} from "../../shared/search";
import { localSearchSources } from "../lib/search";
import { notifyDanteUsage } from "../lib/usageEvents";
import type { ZenosState } from "../types";
type Options = {
  ownerId: string | null;
  isOffline: boolean;
  getToken: () => Promise<string | null>;
  state: ZenosState;
  stateRef: MutableRefObject<ZenosState>;
  isCurrent: () => boolean;
};
export function useSemanticSearch(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(0);
  const [indexError, setError] = useState<string | null>(null);
  const current = () =>
    latest.current.ownerId === options.ownerId &&
    latest.current.isOffline === options.isOffline &&
    latest.current.isCurrent();
  useEffect(() => {
    let active = true;
    setEnabled(false);
    setPending(0);
    setError(null);
    if (!options.ownerId || options.isOffline) return;
    const abort = new AbortController();
    void fetch("/api/search/status", { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && current()) setEnabled(data?.enabled === true);
      })
      .catch(() => {});
    return () => {
      active = false;
      abort.abort();
    };
  }, [options.ownerId, options.isOffline]);
  const request = async (
    url: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ) => {
    if (!current()) throw new Error("Your account changed.");
    const token = await options.getToken();
    if (!current() || signal?.aborted) throw new Error("Search was cancelled.");
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } finally {
      if (method === "POST") notifyDanteUsage();
    }
    const data = await response.json().catch(() => ({}));
    if (!current()) throw new Error("Your account changed.");
    if (!response.ok)
      throw new Error(data.error || "Search is temporarily unavailable.");
    return data;
  };
  const indexNotes = useCallback(
    async (signal?: AbortSignal) => {
      if (options.isOffline) return { indexed: 0, pending: 0 };
      try {
        const result = await request("/api/search/index", "POST", {}, signal);
        if (current()) {
          setPending(Number.isInteger(result.pending) ? result.pending : 0);
          setError(null);
        }
        return result;
      } catch (error) {
        if (current() && !signal?.aborted)
          setError(
            error instanceof Error ? error.message : "Could not index notes.",
          );
        throw error;
      }
    },
    [options.ownerId, options.isOffline, options.getToken],
  );
  // Include searchable fields only: card review/timer/UI renders never spend quota.
  const fingerprint = JSON.stringify([
    options.state.tasks.map((row) => [row.id, row.title, row.note]),
    (options.state.meetings || []).map((row) => [
      row.id,
      row.personName,
      row.subject,
      row.date,
      row.notes,
    ]),
    options.state.vault.map((row) => [row.id, row.name, row.detail, row.url]),
    (options.state.lectures || []).map((row) => [
      row.id,
      row.title,
      row.summary,
    ]),
  ]);
  useEffect(() => {
    if (!enabled || options.isOffline || !options.ownerId || !current()) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void indexNotes(abort.signal).catch(() => {});
    }, 1800);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [fingerprint, enabled, options.ownerId, options.isOffline, indexNotes]);
  const searchNotes = useCallback(
    async (query: string, signal?: AbortSignal): Promise<SearchResponse> => {
      const term = searchQuery(query);
      if (!current()) throw new Error("Your account changed.");
      if (options.isOffline)
        return {
          results: textSearch(
            localSearchSources(options.stateRef.current),
            term,
          ),
          pending: 0,
          mode: "text",
        };
      const data = await request(
        "/api/search",
        "POST",
        { query: term },
        signal,
      );
      const result = {
        results: readSearchResults(data.results),
        pending: Number.isInteger(data.pending) ? data.pending : 0,
        mode: "semantic" as const,
      };
      if (current()) {
        setPending(result.pending);
        setError(null);
      }
      return result;
    },
    [options.ownerId, options.isOffline, options.getToken],
  );
  const getSearchSource = useCallback(
    async (type: SearchType, id: string, signal?: AbortSignal) => {
      if (!isSearchType(type) || !current()) throw new Error("Invalid source.");
      if (options.isOffline) {
        const source = localSearchSources(options.stateRef.current).find(
          (row) => row.sourceType === type && row.sourceId === id,
        );
        if (!source)
          throw new Error(
            "This source was deleted or is unavailable in this workspace.",
          );
        return source;
      }
      return readSearchSource(
        await request(
          `/api/search/source?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
          "GET",
          undefined,
          signal,
        ),
      );
    },
    [options.ownerId, options.isOffline, options.getToken],
  );
  return {
    searchEnabled: options.isOffline || enabled,
    searchIndexPending: pending,
    searchIndexError: indexError,
    indexNotes,
    searchNotes,
    getSearchSource,
  };
}
