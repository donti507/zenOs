"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useZenos } from "../../context/ZenosContext";
import { categoryTone, today } from "../../lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import DanteOrb from "../DanteOrb";
import { Task, DanteMessage } from "../../types";
import Markdown from "../ui/Markdown";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { useSpeechSynthesis, splitSentences } from "../../hooks/useSpeechSynthesis";
import {
  DanteAction,
  parseActions,
  visibleText,
  toSpeech,
  buildDanteContext,
  streamDante,
  DanteRequestError,
} from "../../lib/dante";

const VOICE_LANGS = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "pl-PL", label: "Polski" },
  { code: "de-DE", label: "Deutsch" },
  { code: "es-ES", label: "Español" },
  { code: "fr-FR", label: "Français" },
  { code: "uk-UA", label: "Українська" },
];
const VIEWS = ["dashboard", "kanban", "calendar", "meetings", "analytics", "vault", "dante"];
const HISTORY_TO_SEND = 12;

type ActionResult = { label: string; ok: boolean; detail?: string };
type Status = { ready: boolean; provider: string; model: string | null; problem: string | null; authRequired: boolean };

const loadPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const savePref = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
};

export default function DanteAI() {
  const {
    state,
    stateRef,
    updateState,
    addTask,
    editTask,
    toggleTaskDone,
    addMeeting,
    saveDanteMessage,
    clearDanteHistory,
    googleEvents,
    user,
    isOffline,
    getAuthToken,
  } = useZenos();

  const shouldReduce = useReducedMotion();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedQuery, setLastFailedQuery] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [actionResults, setActionResults] = useState<Record<number, ActionResult[]>>({});
  const [dismissedActions, setDismissedActions] = useState<Record<number, boolean>>(() => loadPref("zenos_dismissed_actions", {}));

  // Voice preferences (remembered between sessions)
  const [voiceLang, setVoiceLang] = useState<string>(() => loadPref("zenos_voice_lang", "en-US"));
  const [ttsOn, setTtsOn] = useState<boolean>(() => loadPref("zenos_tts_on", false));
  const [handsFree, setHandsFree] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);

  useEffect(() => savePref("zenos_voice_lang", voiceLang), [voiceLang]);
  useEffect(() => savePref("zenos_tts_on", ttsOn), [ttsOn]);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;

  const tts = useSpeechSynthesis(voiceLang);
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";

  // ---------- server status ----------
  useEffect(() => {
    fetch("/api/dante/status")
      .then(r => (r.ok ? r.json() : null))
      .then(s => s && setStatus(s))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: shouldReduce ? "auto" : "smooth" });
  }, [state.danteHistory.length, streaming, loading, error]);

  // ---------- actions ----------
  const findTask = (data: any): Task | null => {
    const tasks = stateRef.current.tasks;
    if (data?.id != null) {
      const byId = tasks.find(t => String(t.id) === String(data.id));
      if (byId) return byId;
    }
    const title = String(data?.title || "").trim().toLowerCase();
    if (!title) return null; // an empty title used to match the first task
    const exact = tasks.filter(t => t.title.toLowerCase() === title);
    if (exact.length === 1) return exact[0];
    const partial = tasks.filter(t => t.title.toLowerCase().includes(title));
    return partial.length === 1 ? partial[0] : null;
  };

  const resolveCategory = (cat: unknown): string => {
    const cats = stateRef.current.categories;
    const c = String(cat || "").toLowerCase();
    const hit = cats.find(x => x.id.toLowerCase() === c) || cats.find(x => x.label.toLowerCase() === c);
    return hit?.id || cats.find(x => x.label.toLowerCase() === "other")?.id || cats[0]?.id || "other";
  };

  const validDate = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

  const executeAction = async (a: DanteAction): Promise<ActionResult> => {
    const d = a.data || {};
    switch (a.action) {
      case "create_task": {
        if (!d.title) return { label: "Create task", ok: false, detail: "No title given" };
        const t = await addTask({
          title: String(d.title).slice(0, 200),
          cat: resolveCategory(d.cat),
          status: "todo",
          date: validDate(d.date) || today(),
          reminder: "",
          note: d.note ? String(d.note) : "",
          progress: 0,
          steps: [],
        });
        return { label: `Create task “${d.title}”`, ok: !!t, detail: t ? undefined : "Could not save" };
      }
      case "complete_task":
      case "reopen_task":
      case "toggle_task": {
        const t = findTask(d);
        if (!t) return { label: "Update task", ok: false, detail: `No single task matches “${d.title || d.id || ""}”` };
        const wantDone = a.action === "complete_task" ? true : a.action === "reopen_task" ? false : t.status !== "done";
        if ((t.status === "done") !== wantDone) await toggleTaskDone(t.id);
        return { label: `${wantDone ? "Complete" : "Reopen"} “${t.title}”`, ok: true };
      }
      case "update_task": {
        const t = findTask(d);
        if (!t) return { label: "Update task", ok: false, detail: `No single task matches “${d.title || d.id || ""}”` };
        const updates: Partial<Task> = {};
        if (d.newTitle || (d.title && d.id)) updates.title = String(d.newTitle || d.title);
        if (validDate(d.date)) updates.date = d.date;
        if (["todo", "inprogress", "done"].includes(d.status)) updates.status = d.status;
        if (typeof d.note === "string") updates.note = d.note;
        if (d.cat) updates.cat = resolveCategory(d.cat);
        await editTask(t.id, updates);
        return { label: `Update “${t.title}”`, ok: true };
      }
      case "create_meeting": {
        const m = await addMeeting({
          personName: String(d.personName || "Team"),
          date: validDate(d.date) || today(),
          time: /^\d{1,2}:\d{2}$/.test(d.time || "") ? d.time.padStart(5, "0") : "10:00",
          subject: String(d.subject || "Meeting"),
          status: "upcoming",
          elapsedSeconds: 0,
          notes: "",
        });
        return { label: `Schedule “${d.subject || "Meeting"}”`, ok: !!m, detail: m ? undefined : "Could not save" };
      }
      case "switch_view": {
        if (!VIEWS.includes(d.view)) return { label: "Open view", ok: false, detail: `Unknown view “${d.view}”` };
        updateState({ view: d.view });
        return { label: `Open ${d.view}`, ok: true };
      }
      case "filter_category": {
        const cat = d.cat ? resolveCategory(d.cat) : null;
        updateState({ filterCat: cat, view: "tasks" });
        return { label: cat ? `Filter by ${stateRef.current.categories.find(c => c.id === cat)?.label}` : "Show all tasks", ok: true };
      }
      default:
        return { label: a.action, ok: false, detail: "Unknown action" };
    }
  };

  const runActions = async (msg: DanteMessage) => {
    const actions = parseActions(msg.content);
    if (!actions.length) return;
    const results: ActionResult[] = [];
    for (const a of actions.slice(0, 10)) {
      try {
        results.push(await executeAction(a));
      } catch (e: any) {
        results.push({ label: a.action, ok: false, detail: e?.message });
      }
    }
    setActionResults(r => ({ ...r, [msg.ts]: results }));
  };

  // ---------- sending ----------
  const send = async (raw: string) => {
    const query = raw.trim();
    if (!query || loading) return;

    tts.stop();
    setError(null);
    setLastFailedQuery(null);
    setInput("");
    setLoading(true);
    setStreaming("");

    // Only add the user message to history once (a retry reuses it)
    const history = stateRef.current.danteHistory;
    const last = history[history.length - 1];
    const alreadySaved = last?.role === "user" && last.content === query;
    let messages = history.map(m => ({ role: m.role, content: m.content }));
    if (!alreadySaved) {
      await saveDanteMessage("user", query);
      messages = [...messages, { role: "user" as const, content: query }];
    }
    messages = messages
      .slice(-HISTORY_TO_SEND)
      .map(m => ({ role: m.role, content: m.role === "assistant" ? visibleText(m.content) || "(done)" : m.content }));

    const controller = new AbortController();
    abortRef.current = controller;

    let full = "";
    try {
      const token = await getAuthToken();
      full = await streamDante({
        messages,
        context: buildDanteContext(stateRef.current, googleEvents, userName, voiceLang),
        token,
        signal: controller.signal,
        onText: t => {
          full = t;
          setStreaming(t);
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(
          err instanceof DanteRequestError ? err.message : "Could not reach the server. Check your connection and try again."
        );
        setLastFailedQuery(query);
        setStreaming("");
        setLoading(false);
        abortRef.current = null;
        if (handsFreeRef.current) setHandsFree(false);
        return;
      }
      // Stopped by the user: keep whatever arrived so far
    }

    abortRef.current = null;
    setStreaming("");
    setLoading(false);

    if (!visibleText(full) && !parseActions(full).length) {
      if (!controller.signal.aborted) {
        setError("Dante returned an empty answer. Try rephrasing.");
        setLastFailedQuery(query);
      }
      return;
    }

    const saved = await saveDanteMessage("assistant", full);
    if (!controller.signal.aborted) await runActions(saved);

    if (ttsOn || handsFreeRef.current) {
      await tts.speak(toSpeech(full), saved.ts);
      // Hands-free: listen again once Dante has finished speaking
      if (handsFreeRef.current) setTimeout(() => handsFreeRef.current && speech.start(), 300);
    }
  };

  const stopGenerating = () => abortRef.current?.abort();

  // ---------- voice input ----------
  const speech = useSpeechRecognition({
    lang: voiceLang,
    onFinal: text => {
      if (handsFreeRef.current) {
        send(text);
      } else {
        setInput(prev => (prev ? prev.trimEnd() + " " : "") + text);
        inputRef.current?.focus();
      }
    },
  });

  const toggleMic = () => {
    if (speech.listening) {
      speech.stop();
    } else {
      tts.stop();
      speech.start();
    }
  };

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    if (next) {
      tts.stop();
      speech.start();
    } else {
      speech.cancel();
      tts.stop();
    }
  };

  // Prompts handed over from Home / the header ("Ask Dante…", "Talk to Dante")
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const handoff = location.state as { prompt?: string; voice?: boolean } | null;
    if (!handoff) return;
    navigate(location.pathname, { replace: true, state: null }); // run once, not again on refresh
    if (handoff.prompt) send(handoff.prompt);
    else if (handoff.voice && speech.supported) {
      setHandsFree(true);
      speech.start();
    }
  }, [location.state]);

  // Speech recognition and synthesis hooks clean themselves up when this page unmounts

  // Esc stops generation, speech and listening
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (abortRef.current) abortRef.current.abort();
      tts.stop();
      speech.cancel();
      setHandsFree(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tts.stop, speech.cancel]);

  const dismissActionCard = (ts: number) => {
    setDismissedActions(prev => {
      const updated = { ...prev, [ts]: true };
      savePref("zenos_dismissed_actions", updated);
      return updated;
    });
  };

  // ---------- rendering ----------
  const renderAssistantText = (m: DanteMessage) => {
    if (tts.speakingId === m.ts) {
      // While speaking, show plain sentences so the current one can be highlighted
      const sentences = splitSentences(toSpeech(m.content));
      return (
        <p>
          {sentences.map((s, i) => (
            <span key={i} className={tts.sentenceIndex === i ? "bg-primary-dim text-primary underline decoration-dotted" : ""}>
              {s}{" "}
            </span>
          ))}
        </p>
      );
    }
    return <Markdown text={visibleText(m.content)} />;
  };

  const renderActionCard = (m: DanteMessage) => {
    const actions = parseActions(m.content);
    if (!actions.length || dismissedActions[m.ts]) return null;
    const results = actionResults[m.ts];
    const rows: ActionResult[] = results || actions.map(a => ({ label: a.action.replace(/_/g, " "), ok: true }));
    return (
      <motion.div
        initial={shouldReduce ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-2 p-3 bg-surface-container-lowest rounded-xl ring-1 ring-outline-variant flex flex-col gap-2"
      >
        <div className="text-[10px] font-mono text-text3">
          {results ? `Dante made ${rows.length === 1 ? "this change" : `${rows.length} changes`}` : "Earlier change"}
        </div>
        <ul className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 font-mono text-[12px]">
              <span className={`material-symbols-outlined text-[15px] leading-none ${!results ? "text-text3" : r.ok ? "text-green" : "text-red"}`}>
                {!results ? "history" : r.ok ? "check_circle" : "error"}
              </span>
              <span>
                {r.label}
                {r.detail && <span className="text-text3"> — {r.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={() => dismissActionCard(m.ts)}
          className="self-end px-2.5 py-1 bg-primary/20 hover:bg-primary text-primary hover:text-[#1a0a00] border border-primary text-[10px] font-mono font-bold rounded-xl cursor-pointer"
        >
          Dismiss
        </button>
      </motion.div>
    );
  };

  const suggestions = [
    "What should I focus on today?",
    "Which tasks are overdue?",
    "Add a task to polish design assets tomorrow",
    "Schedule a sync with the team tomorrow at 16:00",
  ];

  const aiUnavailable = !!status && !status.ready;
  const authBlocked = !!status?.authRequired && isOffline;
  const streamingVisible = visibleText(streaming);
  const canSend = !!input.trim() && !loading;

  return (
    <div className="flex flex-col h-full bg-surface-container-lowest md:rounded-xl shadow-soft overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-3 bg-surface-container-lowest shrink-0 select-none">
        <DanteOrb
          size={40}
          state={speech.listening ? "listening" : tts.speakingId !== null ? "speaking" : loading ? "thinking" : "idle"}
        />

        <div className="min-w-0">
          <div className="text-[16px] font-semibold tracking-tight text-on-surface">Dante</div>
          <div className="font-mono text-[10px] text-text3 flex items-center gap-1.5 truncate">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${aiUnavailable ? "bg-red" : loading ? "bg-primary animate-ping" : "bg-green"}`} />
            {speech.listening
              ? "Listening…"
              : tts.speakingId !== null
                ? "Speaking… (Esc to stop)"
                : loading
                  ? "Thinking…"
                  : aiUnavailable
                    ? "AI not configured"
                    : status?.model
                      ? `Ready · ${status.model}`
                      : "Ready"}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-auto relative">
          {speech.supported && (
            <button
              className={`px-2 py-1.5 font-mono text-[10px] font-bold flex items-center gap-1 rounded-xl border cursor-pointer ${handsFree ? "bg-primary text-[#1a0a00] border-primary" : "bg-surface-mid border-border text-text3 hover:text-primary"}`}
              onClick={toggleHandsFree}
              title="Hands-free conversation: speak, hear the answer, then Dante listens again"
              aria-pressed={handsFree}
            >
              <span className="material-symbols-outlined text-[15px] leading-none">{handsFree ? "record_voice_over" : "voice_chat"}</span>
              <span className="hidden md:inline">{handsFree ? "Conversation on" : "Conversation"}</span>
            </button>
          )}

          {tts.supported && (
            <button
              className={`px-2 py-1.5 font-mono text-[10px] font-bold flex items-center gap-1 rounded-xl border cursor-pointer ${ttsOn ? "bg-primary/20 text-primary border-primary" : "bg-surface-mid border-border text-text3"}`}
              onClick={() => {
                if (ttsOn) tts.stop();
                setTtsOn(!ttsOn);
              }}
              title={ttsOn ? "Stop reading answers aloud" : "Read answers aloud"}
              aria-pressed={ttsOn}
            >
              <span className="material-symbols-outlined text-[15px] leading-none">{ttsOn ? "volume_up" : "volume_off"}</span>
            </button>
          )}

          <button className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface cursor-pointer" onClick={() => setShowVoiceMenu(v => !v)} title="Voice language" aria-expanded={showVoiceMenu}>
            <span className="material-symbols-outlined text-[17px]">translate</span>
          </button>
          {showVoiceMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-surface-low border border-border shadow-lg py-1 min-w-[170px]" role="menu">
              {VOICE_LANGS.map(l => (
                <button
                  key={l.code}
                  role="menuitemradio"
                  aria-checked={voiceLang === l.code}
                  className={`w-full text-left px-3 py-1.5 text-[12px] font-mono cursor-pointer hover:bg-surface-mid flex items-center gap-2 ${voiceLang === l.code ? "text-primary" : "text-text"}`}
                  onClick={() => {
                    setVoiceLang(l.code);
                    setShowVoiceMenu(false);
                  }}
                >
                  <span className="material-symbols-outlined text-[14px]">{voiceLang === l.code ? "radio_button_checked" : "radio_button_unchecked"}</span>
                  {l.label}
                </button>
              ))}
            </div>
          )}

          <button
            className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface cursor-pointer"
            onClick={() => {
              if (confirm("Clear the conversation with Dante?")) {
                tts.stop();
                clearDanteHistory();
                setActionResults({});
              }
            }}
            title="Clear conversation"
          >
            <span className="material-symbols-outlined text-[17px]">delete_sweep</span>
          </button>
        </div>
      </div>

      {(aiUnavailable || authBlocked) && (
        <div className="px-4 py-2 bg-red/10 border-b border-red/40 text-[12px] text-text flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-red">warning</span>
          <span>
            {authBlocked
              ? "You're in local mode. Sign in with your account to use Dante on this server."
              : `Dante can't answer yet: ${status?.problem}`}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4 w-full max-w-4xl mx-auto" aria-live="polite">
        {state.danteHistory.length === 0 && !loading && (
          <div className="flex gap-2.5 max-w-[85%]">
            <DanteOrb size={28} className="mt-1" />
            <div className="bg-surface-container-low rounded-2xl rounded-tl-md px-4 py-3 text-[14px] leading-relaxed">
              Hi{userName ? ` ${userName}` : ""}, I'm Dante. I can see your tasks, meetings and calendar.
              Ask me what to focus on, or tell me to add, complete or reschedule things. Type, tap the mic, or start a hands-free conversation.
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {state.danteHistory.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <motion.div
                key={m.ts + "-" + i}
                initial={shouldReduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-2.5 max-w-[88%] ${isUser ? "self-end flex-row-reverse" : ""}`}
              >
                {isUser ? (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary text-[12px] font-semibold shrink-0 mt-0.5">{(userName || "U").slice(0, 1).toUpperCase()}</div>
                ) : (
                  <DanteOrb size={28} className="mt-1" />
                )}
                <div className={`px-4 py-3 text-[14px] leading-relaxed flex flex-col gap-1 min-w-0 break-words rounded-2xl ${isUser ? "bg-primary-container text-on-primary-container rounded-tr-md" : "bg-surface-container-low text-on-surface rounded-tl-md"}`}>
                  {isUser ? <p className="whitespace-pre-wrap">{m.content}</p> : renderAssistantText(m)}
                  {!isUser && renderActionCard(m)}

                  {!isUser && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {tts.supported && (
                        <button
                          className="text-[10px] font-mono text-text3 hover:text-primary flex items-center gap-0.5 cursor-pointer"
                          onClick={() => (tts.speakingId === m.ts ? tts.stop() : tts.speak(toSpeech(m.content), m.ts))}
                        >
                          <span className="material-symbols-outlined text-[14px]">{tts.speakingId === m.ts ? "stop_circle" : "play_circle"}</span>
                          {tts.speakingId === m.ts ? "Stop" : "Listen"}
                        </button>
                      )}
                      <button
                        className="text-[10px] font-mono text-text3 hover:text-primary flex items-center gap-0.5 cursor-pointer"
                        onClick={() => navigator.clipboard?.writeText(visibleText(m.content))}
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>Copy
                      </button>
                      {state.categories
                        .filter(c => visibleText(m.content).toLowerCase().includes(c.label.toLowerCase()))
                        .map(c => {
                          const color = categoryTone(c).hex;
                          return (
                            <button
                              key={c.id}
                              className="px-1.5 py-0.5 border text-[9px] font-mono font-bold cursor-pointer hover:brightness-110"
                              style={{ borderColor: color, color }}
                              onClick={() => updateState({ filterCat: c.id, view: "tasks" })}
                            >
                              View {c.label}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && streamingVisible && (
          <div className="flex gap-2.5 max-w-[88%]">
            <DanteOrb size={28} className="mt-1" />
            <div className="px-4 py-3 bg-surface-container-low rounded-2xl rounded-tl-md text-[14px] leading-relaxed text-on-surface min-w-0 break-words">
              <Markdown text={streamingVisible} />
            </div>
          </div>
        )}

        {loading && !streamingVisible && (
          <div className="flex gap-2.5 max-w-[85%]">
            <DanteOrb size={28} className="mt-1" />
            <div className="px-4 py-3 bg-surface-container-low rounded-2xl rounded-tl-md flex gap-1 items-center">
              <span className="font-mono text-[10px] text-primary mr-1.5">Thinking</span>
              {[0, 0.15, 0.3].map(d => (
                <motion.div key={d} animate={shouldReduce ? {} : { y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: d }} className="w-1.5 h-1.5 rounded-full bg-primary" />
              ))}
            </div>
          </div>
        )}

        {/* Errors are shown here with a retry, and are no longer saved into the chat history */}
        {error && (
          <div className="self-stretch p-3 border border-red/50 bg-red/10 text-[12px] flex flex-wrap items-center gap-2" role="alert">
            <span className="material-symbols-outlined text-[16px] text-red">error</span>
            <span className="flex-1 min-w-[200px]">{error}</span>
            {lastFailedQuery && (
              <button className="px-2.5 py-1 border border-primary text-primary font-mono text-[10px] font-bold rounded-xl cursor-pointer hover:bg-primary-dim" onClick={() => send(lastFailedQuery)}>
                Retry
              </button>
            )}
            <button className="text-text3 hover:text-text cursor-pointer" onClick={() => setError(null)} aria-label="Dismiss error">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {state.danteHistory.length === 0 && !loading && (
        <div className="flex gap-1.5 px-4 pb-2.5 flex-wrap shrink-0 select-none">
          {suggestions.map(s => (
            <button
              key={s}
              className="px-2.5 py-1 bg-surface-mid border border-border text-text3 text-[11px] font-mono cursor-pointer rounded-xl hover:border-primary hover:text-primary"
              onClick={() => send(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {speech.error && (
        <div className="mx-3 mb-1 px-3 py-1.5 text-[11px] border border-red/40 bg-red/10 flex items-center gap-2" role="alert">
          <span className="material-symbols-outlined text-[14px] text-red">mic_off</span>
          <span className="flex-1">{speech.error}</span>
          <button className="cursor-pointer text-text3" onClick={() => speech.setError(null)} aria-label="Dismiss">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 md:p-4 border-t border-outline-variant flex gap-2 bg-surface-container-lowest shrink-0 items-end">
        <button
          className={`w-[42px] h-[42px] shrink-0 flex items-center justify-center border rounded-xl cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${speech.listening ? "bg-red text-white border-red" : "bg-surface-high border-border text-text3 hover:text-primary"}`}
          onClick={toggleMic}
          disabled={!speech.supported}
          title={!speech.supported ? "Voice input isn't supported in this browser (try Chrome, Edge or Safari)" : speech.listening ? "Stop listening" : `Speak (${VOICE_LANGS.find(l => l.code === voiceLang)?.label})`}
          aria-pressed={speech.listening}
          aria-label={speech.listening ? "Stop listening" : "Start voice input"}
        >
          {speech.listening ? (
            <div className="flex items-center gap-[2px]">
              <span className="w-[3px] h-3 bg-white rounded-full animate-bounce" />
              <span className="w-[3px] h-4 bg-white rounded-full animate-bounce [animation-delay:0.15s]" />
              <span className="w-[3px] h-2 bg-white rounded-full animate-bounce [animation-delay:0.3s]" />
            </div>
          ) : (
            <span className="material-symbols-outlined text-[18px]">mic</span>
          )}
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          className="flex-1 min-h-[44px] max-h-[120px] resize-none px-4 py-2.5 rounded-xl bg-surface-container-low text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary/25"
          value={speech.listening && speech.interim ? (input ? input + " " : "") + speech.interim : input}
          onChange={e => setInput(e.target.value)}
          readOnly={speech.listening}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={speech.listening ? "Listening… speak now" : handsFree ? "Conversation mode is on — just talk" : "Ask Dante anything…"}
          aria-label="Message Dante"
        />

        {loading ? (
          <button
            className="h-[44px] px-4 bg-surface-high border border-primary text-primary font-mono text-[11px] font-bold flex items-center gap-1 rounded-xl cursor-pointer"
            onClick={stopGenerating}
            title="Stop (Esc)"
          >
            <span className="material-symbols-outlined text-[16px]">stop</span>Stop
          </button>
        ) : (
          <button
            className="bg-primary text-[#2c1600] h-[44px] px-4 font-mono text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed rounded-xl"
            onClick={() => send(input)}
            disabled={!canSend}
          >
            <span className="material-symbols-outlined text-[16px]">send</span>Send
          </button>
        )}
      </div>
    </div>
  );
}
