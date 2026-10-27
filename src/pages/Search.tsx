import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useZenos } from "../context/ZenosContext";
import {
  isSearchType,
  sourcePath,
  type SearchResponse,
  type SearchSource,
  type SearchType,
} from "../../shared/search";
import { PageHeader, EmptyState, btn, card, input } from "../components/ui/kit";
import DanteUsageNotice from "../components/DanteUsageNotice";
const labels: Record<SearchType, string> = {
  task: "Task notes",
  meeting: "Meeting notes",
  vault: "Vault item",
  lecture: "Lecture summary",
};
export default function Search() {
  const {
    state,
    user,
    isOffline,
    searchEnabled,
    searchIndexPending,
    searchIndexError,
    searchNotes,
    getSearchSource,
    indexNotes,
    setEditTaskId,
    setShowModal,
  } = useZenos();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [source, setSource] = useState<SearchSource | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const active = useRef<AbortController | null>(null);
  const read = useRef(0);
  const searching = useRef(false);
  const type = params.get("type");
  const id = params.get("id");
  useEffect(() => {
    setResponse(null);
    setSource(null);
    setError("");
    setBusy(false);
    setIndexing(false);
    return () => {
      ++read.current;
      active.current?.abort();
      searching.current = false;
    };
  }, [user?.id, isOffline]);
  useEffect(() => {
    if (!type && !id) {
      setSource(null);
      return;
    }
    searching.current = false;
    setIndexing(false);
    setResponse(null);
    const version = ++read.current;
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    setSource(null);
    setError("");
    if (!isSearchType(type) || !id) {
      setError("Invalid source link.");
      return;
    }
    setBusy(true);
    void getSearchSource(type, id, abort.signal)
      .then((row) => {
        if (!abort.signal.aborted && version === read.current) setSource(row);
      })
      .catch((failure) => {
        if (!abort.signal.aborted && version === read.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not open source.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted && version === read.current) setBusy(false);
      });
    return () => abort.abort();
  }, [type, id, user?.id, isOffline, getSearchSource]);
  const search = async () => {
    if (searching.current || !query.trim()) return;
    searching.current = true;
    const version = ++read.current;
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    setBusy(true);
    setError("");
    setSource(null);
    setResponse(null);
    if (type || id) setParams({ q: query }, { replace: true });
    try {
      const data = await searchNotes(query, abort.signal);
      if (!abort.signal.aborted && version === read.current) setResponse(data);
    } catch (failure) {
      if (!abort.signal.aborted && version === read.current)
        setError(failure instanceof Error ? failure.message : "Search failed.");
    } finally {
      if (version === read.current) {
        setBusy(false);
        searching.current = false;
      }
    }
  };
  const index = async () => {
    if (indexing) return;
    setIndexing(true);
    setError("");
    const abort = new AbortController();
    active.current?.abort();
    active.current = abort;
    try {
      await indexNotes(abort.signal);
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Could not index notes.",
        );
    } finally {
      if (!abort.signal.aborted) setIndexing(false);
    }
  };
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Search"
        subtitle="Find ideas across task notes, meeting notes, vault items and lecture summaries."
      />
      <section className={`${card} p-5 space-y-4`}>
        <p className="text-sm text-on-surface-variant">
          {isOffline
            ? "Local text search searches this browser’s saved notes. Sign in to use semantic search."
            : "Search by meaning, such as “what did Alex say about the launch?” Notes are sent to your configured embedding provider when indexed. Indexing and searches use your daily Dante message allowance."}
        </p>
        <form
          className="flex flex-col sm:flex-row gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label className="flex-1 min-w-0">
            <span className="sr-only">Search your notes</span>
            <input
              className={input}
              value={query}
              maxLength={500}
              placeholder="What did Alex say about the launch?"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className={btn.solid}
            disabled={busy || indexing || !query.trim() || !searchEnabled}
          >
            {busy
              ? "Searching…"
              : isOffline
                ? "Search locally"
                : "Search notes"}
          </button>
        </form>
        {!isOffline && !searchEnabled && (
          <p role="status" className="text-sm text-on-surface-variant">
            Semantic search needs the embedding provider, Supabase service
            credentials and the latest pgvector migration configured on the
            server.
          </p>
        )}
        {!isOffline && searchEnabled && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={btn.secondary}
              disabled={busy || indexing}
              onClick={() => void index()}
            >
              {indexing ? "Indexing…" : "Index pending notes"}
            </button>
            <span className="text-xs text-on-surface-variant">
              {searchIndexPending > 0
                ? `${searchIndexPending} note sections still pending. Each click indexes up to 16.`
                : "Saved changes are queued automatically for indexing."}
            </span>
          </div>
        )}
        {searchIndexError && (
          <p className="text-sm text-on-surface-variant">
            Automatic indexing paused: {searchIndexError}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-primary">
            {type && id ? "Opening source…" : "Searching your notes…"}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error break-words">
            {error}
          </p>
        )}
      </section>
      {!isOffline && <DanteUsageNotice />}
      {source && (
        <article className={`${card} p-5 space-y-4`} aria-label="Search source">
          <p className="text-xs uppercase text-primary">
            {labels[source.sourceType]}
          </p>
          <h2 className="font-semibold break-words [overflow-wrap:anywhere]">
            {source.title}
          </h2>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-on-surface-variant">
            {source.content}
          </p>
          {source.sourceType === "task" ? (
            <button
              className={btn.secondary}
              onClick={() => {
                setEditTaskId(
                  state.tasks.find(
                    (task) => String(task.id) === source.sourceId,
                  )?.id ?? source.sourceId,
                );
                setShowModal("editTask");
              }}
            >
              Open task
            </button>
          ) : (
            <Link
              className={btn.secondary}
              to={
                source.sourceType === "meeting"
                  ? "/meetings"
                  : source.sourceType === "vault"
                    ? "/vault"
                    : `/lectures?id=${encodeURIComponent(source.sourceId)}`
              }
            >
              Open{" "}
              {source.sourceType === "meeting"
                ? "Meetings"
                : source.sourceType === "vault"
                  ? "Vault"
                  : "Lectures"}
            </Link>
          )}
        </article>
      )}
      {response && (
        <section aria-label="Search results" className="space-y-3">
          <p role="status" className="text-sm text-on-surface-variant">
            {response.results.length}{" "}
            {response.mode === "text"
              ? response.results.length === 1
                ? "text match"
                : "text matches"
              : response.results.length === 1
                ? "source"
                : "sources"}
            {response.pending > 0
              ? ` · ${response.pending} sections still need indexing; these results may be incomplete.`
              : ""}
          </p>
          {response.results.map((row, i) => (
            <article
              key={`${row.sourceType}:${row.sourceId}`}
              className={`${card} p-5 space-y-2`}
            >
              <p className="text-xs text-primary">
                [S{i + 1}] {labels[row.sourceType]}
              </p>
              <Link
                className="block font-semibold text-on-surface hover:text-primary break-words [overflow-wrap:anywhere] underline underline-offset-4"
                to={sourcePath(row)}
              >
                {row.title}
              </Link>
              <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-on-surface-variant">
                {row.content}
              </p>
            </article>
          ))}
          {!response.results.length && (
            <EmptyState
              icon="search"
              title="No matching notes"
              text={
                response.pending
                  ? "Index the remaining notes, then try searching again."
                  : "Try another phrase, a person’s name or a more specific topic."
              }
            />
          )}
        </section>
      )}
      {!response && !source && !busy && (
        <EmptyState
          icon="search"
          title="Your notes, connected"
          text="Search for a topic or a question. Results include the saved source so you can check the context."
        />
      )}
    </div>
  );
}
