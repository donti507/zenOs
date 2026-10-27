import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useZenos } from "../context/ZenosContext";
import {
  type SpaceSnapshot,
  type SpaceVersionInfo,
  noSpacePermissions,
} from "../../shared/space";
import PublishSpace from "../components/PublishSpace";
import ModelArena from "../components/ModelArena";
import SpaceLearn from "../components/SpaceLearn";
import SpaceFrame from "../components/SpaceFrame";
import DanteUsageNotice from "../components/DanteUsageNotice";
import {
  PageHeader,
  Modal,
  EmptyState,
  btn,
  card,
  input,
  textarea,
} from "../components/ui/kit";
type Status = {
  ready: boolean;
  models: string[];
  problem: string | null;
  authRequired: boolean;
};
export default function Space() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const arenaTab = !slug && searchParams.get("tab") === "arena";
  const navigate = useNavigate();
  const {
    user,
    isOffline,
    setLiveOpen,
    spacePages,
    changeSpaceWidget,
    spacePagesLoading,
    spacePagesError,
    refreshSpacePages,
    createSpacePage,
    loadSpacePage,
    spaceHistory,
    editSpacePage,
    restoreSpaceVersion,
    setSpacePermissions,
  } = useZenos();
  const [publishOpen,setPublishOpen]=useState(false);
  const [learnMode, setLearnMode] = useState(false);
  const [learnVersion, setLearnVersion] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SpaceSnapshot | null>(null);
  const [history, setHistory] = useState<SpaceVersionInfo[]>([]);
  const [more, setMore] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [addressDirty, setAddressDirty] = useState(false);
  const [address, setAddress] = useState("");
  const [permissions, setPermissions] = useState(noSpacePermissions);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [restore, setRestore] = useState<SpaceVersionInfo | null>(null);
  const operation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void fetch("/api/space/status", { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) {
          setStatus(data);
          setModel(data.models?.[0] || "");
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      abort.abort();
    };
  }, []);
  const readHistory = async (pageId: string, offset = 0) => {
    const version = generation.current;
    const rows = await spaceHistory(pageId, offset);
    if (version !== generation.current) return;
    setHistory((old) =>
      offset
        ? [
            ...old,
            ...rows.filter(
              (row) => !old.some((previous) => previous.id === row.id),
            ),
          ]
        : rows,
    );
    setMore(rows.length === 30);
  };
  useEffect(() => {
    const version = ++generation.current;
    operation.current?.abort();
    running.current = false;
    attempt.current = null;
    setBusy(false);
    setSnapshot(null);
    setHistory([]);
    setLearnVersion(null);
    setError("");
    setPrompt("");
    setPermissionOpen(false);
    setPublishOpen(false);
    setRestore(null);
    setMore(false);
    if (!slug) {
      setLoading(false);
      return () => {
        ++generation.current;
        operation.current?.abort();
      };
    }
    let active = true;
    setLoading(true);
    void loadSpacePage(slug)
      .then(async (data) => {
        if (!active || version !== generation.current) return;
        setSnapshot(data);
        await readHistory(data.page.id);
      })
      .catch((failure) => {
        if (active && version === generation.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not open this page.",
          );
      })
      .finally(() => {
        if (active && version === generation.current) setLoading(false);
      });
    return () => {
      active = false;
      ++generation.current;
      operation.current?.abort();
    };
  }, [slug, user?.id, isOffline, loadSpacePage]);
  useEffect(() => {
    if (!slug) return;
    const focus = () => {
      if (running.current) return;
      const version = generation.current;
      void loadSpacePage(slug)
        .then((data) => {
          if (version === generation.current) {
            setSnapshot(data);
            void readHistory(data.page.id);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [slug, loadSpacePage]);
  const savedVersion = spacePages.find(page => page.slug === slug)?.currentVersionId;
  useEffect(() => {
    if (!slug || !snapshot || busy || !savedVersion || savedVersion === snapshot.version.id) return;
    let active = true;
    const version = generation.current;
    void loadSpacePage(slug).then(async data => {
      if (!active || version !== generation.current) return;
      setSnapshot(data);
      setLearnVersion(null);
      await readHistory(data.page.id);
    }).catch(() => { if (active && version === generation.current) setError('A new save point is available. Refresh this page to load it.'); });
    return () => { active = false; };
  }, [slug, savedVersion, snapshot?.version.id, busy, loadSpacePage]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    operation.current = abort;
    try {
      await work(abort.signal);
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "This change was not confirmed. Refresh and try again.",
        );
    } finally {
      if (operation.current === abort) {
        operation.current = null;
        running.current = false;
        setBusy(false);
      }
    }
  };
  const create = () =>
    run(async (signal) => {
      const data = await createSpacePage(title, address);
      if (!signal.aborted) {
        setTitle("");
        setAddress("");
        setAddressDirty(false);
        navigate(`/space/${data.page.slug}`);
      }
    });
  const edit = () =>
    run(async (signal) => {
      if (!snapshot) return;
      const key = JSON.stringify([
        snapshot.page.id,
        snapshot.version.id,
        prompt,
        model,
      ]);
      if (attempt.current?.key !== key)
        attempt.current = { key, id: crypto.randomUUID() };
      const data = await editSpacePage(
        snapshot,
        prompt,
        model,
        attempt.current.id,
        signal,
      );
      if (signal.aborted) return;
      setSnapshot(data);
      setPrompt("");
      setLearnVersion(data.version.id);
      attempt.current = null;
      await readHistory(data.page.id);
    });
  const refresh = () =>
    run(async (signal) => {
      if (slug) {
        const data = await loadSpacePage(slug);
        if (signal.aborted) return;
        setSnapshot(data);
        await readHistory(data.page.id);
      } else await refreshSpacePages();
    });
  const applyPermissions = () =>
    run(async (signal) => {
      if (!snapshot) return;
      const page = await setSpacePermissions(snapshot, permissions);
      if (signal.aborted) return;
      setSnapshot({ ...snapshot, page });
      setPermissionOpen(false);
    });
  const restoreVersion = () =>
    run(async (signal) => {
      if (!snapshot || !restore) return;
      const data = await restoreSpaceVersion(
        snapshot,
        restore.id,
        crypto.randomUUID(),
      );
      if (signal.aborted) return;
      setSnapshot(data);
      setRestore(null);
      setLearnVersion(data.version.id);
      attempt.current = null;
      await readHistory(data.page.id);
    });
  const revoke = () =>
    run(async (signal) => {
      if (!snapshot) return;
      const page = await setSpacePermissions(snapshot, noSpacePermissions());
      if (!signal.aborted) setSnapshot({ ...snapshot, page });
    });
  const tabs = <nav aria-label="My Space tabs" className="flex flex-wrap gap-2">
    <Link className={arenaTab ? btn.secondary : btn.solid} to="/space" aria-current={!arenaTab ? 'page' : undefined}>My pages</Link>
    <Link className={btn.secondary} to="/gallery">Gallery</Link>
    <Link className={arenaTab ? btn.solid : btn.secondary} to="/space?tab=arena" aria-current={arenaTab ? 'page' : undefined}>Model Arena</Link>
  </nav>;
  if (arenaTab) return <div className="min-w-0 space-y-5"><PageHeader title="My Space" subtitle="Compare models with your own prompts."/>{tabs}<ModelArena/></div>;
  const blocked =
    !status?.ready || !model || (status.authRequired && isOffline);
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={snapshot?.page.title || "My Space"}
        subtitle="Private pages you build by chatting with AI."
      />
      {tabs}
      <div className="flex flex-wrap gap-2">
        <Link className={btn.secondary} to="/space">
          All pages
        </Link>
        <button
          className={btn.secondary}
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        {snapshot && <button type="button" className={btn.secondary} disabled={busy || loading || blocked} onClick={() => setLiveOpen(true)}>Edit by voice</button>}
        {snapshot && <button type="button" role="switch" aria-checked={learnMode} className={learnMode ? btn.solid : btn.secondary} onClick={() => setLearnMode(value => !value)}>Learn mode</button>}
        {snapshot && <details className="relative">
          <summary className={`${btn.secondary} cursor-pointer`}>Page menu</summary>
          <div className={`${card} absolute z-10 mt-2 p-3 min-w-52 space-y-2`}>
            <button className={btn.secondary} disabled={busy} onClick={()=>setPublishOpen(true)}>Publish to gallery</button>
            {spacePages.find(page => page.id === snapshot.page.id)?.dashboardSize ?
              <button className={btn.secondary} disabled={busy} onClick={() => void run(async () => changeSpaceWidget(snapshot.page.id,"unpin"))}>Unpin from Home</button> :
              <button className={btn.secondary} disabled={busy} onClick={() => void run(async () => changeSpaceWidget(snapshot.page.id,"small"))}>Pin to Home</button>}
          </div>
        </details>}
        {busy && (
          <button
            className={btn.secondary}
            onClick={() => {
              operation.current?.abort();
              running.current = false;
              setBusy(false);
              setError(
                "Stopped. A completed edit may already be saved; refresh history before retrying.",
              );
            }}
          >
            Stop
          </button>
        )}
      </div>
      {(error || spacePagesError) && (
        <p role="alert" className="text-error text-sm break-words">
          {error || spacePagesError}
        </p>
      )}
      {!slug ? (
        <>
          <section
            className={`${card} p-5 space-y-4`}
            aria-label="Create a personal page"
          >
            <h2 className="font-semibold">Create a page</h2>
            <p className="text-sm text-on-surface-variant">
              Only you can open your pages. Give one a name, then describe what
              you want to build.
            </p>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="block text-sm">
                Page title
                <input
                  className={`${input} mt-1`}
                  maxLength={80}
                  value={title}
                  disabled={busy}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (!addressDirty)
                      setAddress(
                        event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")
                          .slice(0, 48),
                      );
                  }}
                />
              </label>
              <label className="block text-sm">
                Page address
                <span className="block text-xs text-on-surface-variant mt-1">
                  /space/
                </span>
                <input
                  className={`${input} mt-1`}
                  value={address}
                  maxLength={48}
                  disabled={busy}
                  onChange={(event) => {
                    setAddressDirty(true);
                    setAddress(event.target.value);
                  }}
                />
              </label>
              <button
                className={btn.solid}
                disabled={busy || !title.trim() || !address.trim()}
              >
                {busy ? "Creating…" : "Create page"}
              </button>
            </form>
          </section>
          <section className="space-y-3" aria-label="Your private pages">
            {spacePagesLoading && <p role="status">Loading pages…</p>}
            {spacePages.map((page) => (
              <Link
                key={page.id}
                to={`/space/${page.slug}`}
                className={`${card} block p-5 hover:ring-1 hover:ring-primary/30`}
              >
                <h2 className="font-semibold break-words">{page.title}</h2>
                <p className="text-sm text-on-surface-variant break-all">
                  /space/{page.slug} · Private
                </p>
              </Link>
            ))}
            {!spacePagesLoading && !spacePages.length && (
              <EmptyState
                icon="dashboard_customize"
                title="A place for your own ideas"
                text="Build a timer, study dashboard, habit tracker or another small page."
              />
            )}
          </section>
        </>
      ) : loading ? (
        <p role="status" className="text-on-surface-variant">
          Loading your page…
        </p>
      ) : snapshot ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_350px] gap-6 items-start">
            <div className="min-w-0 space-y-5">
              {snapshot.page.remixSource&&<p className="text-sm text-on-surface-variant break-words">Remixed from <Link className="text-primary underline" to={`/gallery/${snapshot.page.remixSource.id}`}>{snapshot.page.remixSource.title}</Link> by {snapshot.page.remixSource.author}.{snapshot.page.remixSource.original&&<> Originally by <Link className="text-primary underline" to={`/gallery/${snapshot.page.remixSource.original.id}`}>{snapshot.page.remixSource.original.author}</Link>.</>}</p>}
              <SpaceFrame snapshot={snapshot} />
              {learnMode && <SpaceLearn pageId={snapshot.page.id} versionId={learnVersion || snapshot.version.id} />}
              <section
                className={`${card} p-5 space-y-3`}
                aria-label="Page data permissions"
              >
                <h2 className="font-semibold">Data access</h2>
                <p className="text-sm text-on-surface-variant">
                  Tasks: {snapshot.page.permissions.tasks ? "on" : "off"} ·
                  Events: {snapshot.page.permissions.events ? "on" : "off"}.
                  Changes and restores turn both off.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={btn.secondary}
                    disabled={busy}
                    onClick={() => {
                      setPermissions(snapshot.page.permissions);
                      setPermissionOpen(true);
                    }}
                  >
                    Manage page access
                  </button>
                  {(snapshot.page.permissions.tasks ||
                    snapshot.page.permissions.events) && (
                    <button
                      className={btn.secondary}
                      disabled={busy}
                      onClick={() => void revoke()}
                    >
                      Revoke all access
                    </button>
                  )}
                </div>
              </section>
              <details className={`${card} p-5`}>
                <summary className="cursor-pointer font-medium">
                  View saved code
                </summary>
                {(["html", "css", "js"] as const).map((type) => (
                  <label key={type} className="block text-sm uppercase mt-4">
                    {type}
                    <textarea
                      readOnly
                      className={`${textarea} mt-1 font-mono text-xs`}
                      value={snapshot.version[type]}
                      rows={5}
                    />
                  </label>
                ))}
              </details>
            </div>
            <div className="min-w-0 space-y-5">
              <section
                className={`${card} p-5 space-y-4`}
                aria-label="Chat with page builder"
              >
                <h2 className="font-semibold">Build with AI</h2>
                <p className="text-sm text-on-surface-variant">
                  Each edit saves a version and uses one Dante message. Only
                  this page’s code and edit history go to the model.
                </p>
                <label className="block text-sm">
                  Model
                  <select
                    className={`${input} mt-1`}
                    value={model}
                    disabled={busy || !status?.ready}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {status?.models.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void edit();
                  }}
                >
                  <label className="block text-sm">
                    Describe your edit
                    <textarea
                      className={`${textarea} mt-1`}
                      maxLength={2000}
                      value={prompt}
                      disabled={busy}
                      placeholder="Build a weekly study dashboard with a focus timer…"
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </label>
                  <button
                    className={`${btn.solid} w-full`}
                    disabled={busy || blocked || !prompt.trim()}
                  >
                    {busy
                      ? "Building and saving…"
                      : attempt.current
                        ? "Retry edit"
                        : "Send edit"}
                  </button>
                </form>
                {blocked && (
                  <p className="text-xs text-on-surface-variant">
                    {status?.authRequired && isOffline
                      ? "Sign in to use AI editing on this server."
                      : status?.problem ||
                        "AI page editing needs a configured server model."}
                  </p>
                )}
                {busy && (
                  <p role="status" className="text-primary text-sm">
                    Working on this page. Keep it open while the edit is saved.
                  </p>
                )}
                {history
                  .filter((row) => row.kind === "ai")
                  .slice(0, 5)
                  .reverse()
                  .map((row) => (
                    <div
                      key={row.id}
                      className="space-y-2 border-t border-outline-variant pt-3 text-sm"
                    >
                      <p className="whitespace-pre-wrap break-words">
                        <span className="font-medium">You: </span>
                        {row.prompt}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-on-surface-variant">
                        <span className="font-medium">Builder: </span>
                        {row.reply}
                      </p>
                    </div>
                  ))}
              </section>
              {!isOffline && <DanteUsageNotice />}
              <section
                className={`${card} p-5 space-y-3`}
                aria-label="Page version timeline"
              >
                <h2 className="font-semibold">Save points</h2>
                <p className="text-xs text-on-surface-variant">
                  Restore creates a new save point. Earlier versions remain
                  available.
                </p>
                <ol className="space-y-3">
                  {history.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg bg-surface-container-low p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {row.kind === "initial"
                            ? "Created"
                            : row.kind === "restore"
                              ? "Restored"
                              : "AI edit"}
                          {row.id === snapshot.version.id ? " · Current" : ""}
                        </span>
                        <time className="text-xs text-on-surface-variant">
                          {new Date(row.createdAt).toLocaleString()}
                        </time>
                      </div>
                      {row.prompt && (
                        <p className="text-sm text-on-surface-variant break-words line-clamp-3">
                          {row.prompt}
                        </p>
                      )}
                      {row.model && (
                        <p className="text-xs text-on-surface-variant break-all">
                          {row.model}
                        </p>
                      )}
                      {learnMode && <button className={`${btn.secondary} text-sm`} onClick={() => setLearnVersion(row.id)} aria-pressed={(learnVersion || snapshot.version.id) === row.id}>Explain this version</button>}
                      <button
                        className={`${btn.secondary} text-sm`}
                        disabled={busy || row.id === snapshot.version.id}
                        onClick={() => setRestore(row)}
                      >
                        Restore this version
                      </button>
                    </li>
                  ))}
                </ol>
                {more && (
                  <button
                    className={btn.secondary}
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        readHistory(snapshot.page.id, history.length),
                      )
                    }
                  >
                    Load older versions
                  </button>
                )}
              </section>
            </div>
          </div>
        </>
      ) : !error ? (
        <EmptyState
          icon="dashboard_customize"
          title="Page not found"
          text="Choose one of your pages or create a new one."
        />
      ) : null}
      {publishOpen&&snapshot&&<PublishSpace snapshot={snapshot} onClose={()=>setPublishOpen(false)}/>}
      <Modal
        open={permissionOpen}
        onClose={() => !busy && setPermissionOpen(false)}
        title="Allow this page to read data?"
        footer={
          <>
            <button
              className={btn.secondary}
              disabled={busy}
              onClick={() => setPermissionOpen(false)}
            >
              Cancel
            </button>
            <button
              className={btn.solid}
              disabled={busy}
              onClick={() => void applyPermissions()}
            >
              Save access
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          This version’s JavaScript can read and display the selected fields. It
          cannot change app data. Notes, cookies, account details and tokens are
          never shared. Future edits and restores require permission again.
        </p>
        <label className="flex gap-3 items-start">
          <input
            type="checkbox"
            checked={permissions.tasks}
            disabled={busy}
            onChange={(event) =>
              setPermissions((value) => ({
                ...value,
                tasks: event.target.checked,
              }))
            }
          />
          <span>
            Tasks: titles, status, due dates and progress (up to 200).
          </span>
        </label>
        <label className="flex gap-3 items-start">
          <input
            type="checkbox"
            checked={permissions.events}
            disabled={busy}
            onChange={(event) =>
              setPermissions((value) => ({
                ...value,
                events: event.target.checked,
              }))
            }
          />
          <span>
            Events: titles and times from meetings and connected Calendar events
            (up to 200).
          </span>
        </label>
      </Modal>
      <Modal
        open={!!restore}
        onClose={() => !busy && setRestore(null)}
        title="Restore this version?"
        footer={
          <>
            <button
              className={btn.secondary}
              disabled={busy}
              onClick={() => setRestore(null)}
            >
              Cancel
            </button>
            <button
              className={btn.solid}
              disabled={busy}
              onClick={() => void restoreVersion()}
            >
              Restore version
            </button>
          </>
        }
      >
        <p>
          The current page will switch to this saved code. A new version will be
          added to the timeline and data permissions will be turned off.
        </p>
      </Modal>
    </div>
  );
}
