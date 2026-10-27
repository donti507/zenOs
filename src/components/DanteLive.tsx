import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useZenos } from '../context/ZenosContext';
import DanteOrb, { OrbState } from './DanteOrb';
import { Icon } from './ui/kit';
import { useDanteStatus } from '../hooks/useDanteStatus';
import { useRecorderTranscription } from '../hooks/useRecorderTranscription';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { buildDanteContext, parseActions, streamDante, toSpeech, visibleText, DanteRequestError } from '../lib/dante';
import { runDanteActions, ActionResult } from '../lib/danteActions';

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

const PREFS = 'zenos_live_prefs';
type Prefs = { voiceURI: string; rate: number; bargeIn: boolean };
const loadPrefs = (): Prefs => {
  try { return { voiceURI: '', rate: 1.05, bargeIn: false, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { voiceURI: '', rate: 1.05, bargeIn: false }; }
};

/** Live microphone level (0–1) for the orb and for voice interruption. */
function useMicLevel(active: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let alive = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(s => {
      if (!alive) return s.getTracks().forEach(t => t.stop());
      stream = s;
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(l => l * 0.6 + Math.min(1, Math.sqrt(sum / buf.length) * 7) * 0.4);
        raf = requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      setLevel(0);
    };
  }, [active]);
  return level;
}

const VOICE_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'uk-UA', label: 'Українська' },
];

export default function DanteLive() {
  const {
    liveOpen, setLiveOpen, stateRef, user, isOffline, googleEvents, getAuthToken, saveDanteMessage,
    addTask, editTask, toggleTaskDone, addMeeting, updateState, rememberFact, forgetFact, confirmForgetFact,
  } = useZenos();
  const reduce = useReducedMotion();
  const status = useDanteStatus();

  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [results, setResults] = useState<ActionResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [lang, setLang] = useState<string>(() => { try { return JSON.parse(localStorage.getItem('zenos_voice_lang') || '"en-US"'); } catch { return 'en-US'; } });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const phaseRef = useRef(phase); phaseRef.current = phase;
  const openRef = useRef(liveOpen); openRef.current = liveOpen;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const abortRef = useRef<AbortController | null>(null);
  const ttsRun = useRef(0);

  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);
  useEffect(() => { try { localStorage.setItem('zenos_voice_lang', JSON.stringify(lang)); } catch { /* ignore */ } }, [lang]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const langVoices = voices.filter(v => v.lang.startsWith(lang.split('-')[0]));
  const pickVoice = () =>
    voices.find(v => v.voiceURI === prefs.voiceURI && v.lang.startsWith(lang.split('-')[0])) ||
    langVoices.find(v => /natural|neural|google|premium|enhanced/i.test(v.name)) ||
    langVoices[0] || null;

  // ---------- microphone ----------
  const onUtterance = (text: string) => { if (openRef.current) ask(text); };
  const server = useRecorderTranscription({ lang, onFinal: onUtterance, getToken: getAuthToken });
  const browser = useSpeechRecognition({ lang, onFinal: onUtterance });
  const mic = status?.stt && server.supported ? server : browser;
  const level = useMicLevel(liveOpen && !paused);

  useEffect(() => {
    if (mic.listening) setPhase('listening');
    else if (mic.interim === 'Transcribing…') setPhase('transcribing');
    else if (phaseRef.current === 'listening' || phaseRef.current === 'transcribing') setPhase('idle');
  }, [mic.listening, mic.interim]);
  useEffect(() => { if (mic.error) { setError(mic.error); mic.setError(null); } }, [mic.error]);

  const listen = useCallback(() => {
    if (!openRef.current || pausedRef.current) return;
    setError(null);
    mic.start();
  }, [mic]);

  // ---------- speaking: sentences are spoken while the answer is still streaming ----------
  const stopSpeaking = () => { ttsRun.current++; if ('speechSynthesis' in window) speechSynthesis.cancel(); };

  const makeSpeaker = () => {
    const run = ++ttsRun.current;
    let pending = 0;
    let finished = false;
    let resolveDone: () => void = () => {};
    const done = new Promise<void>(r => (resolveDone = r));
    const check = () => { if (finished && pending === 0) resolveDone(); };
    const speak = (text: string) => {
      const clean = text.trim();
      if (!clean || run !== ttsRun.current || !('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = lang;
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = prefs.rate;
      pending++;
      u.onstart = () => run === ttsRun.current && setPhase('speaking');
      u.onend = u.onerror = () => { pending--; check(); };
      speechSynthesis.speak(u);
    };
    return { speak, done, finish: () => { finished = true; check(); }, isCurrent: () => run === ttsRun.current };
  };

  // ---------- one turn of conversation ----------
  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return listen();
    stopSpeaking();
    abortRef.current?.abort();
    setHeard(q);
    setReply('');
    setResults([]);
    setError(null);
    setPhase('thinking');

    const history = [...stateRef.current.danteHistory, { role: 'user' as const, content: q, ts: Date.now() }]
      .slice(-10)
      .map(m => ({ role: m.role, content: m.role === 'assistant' ? visibleText(m.content) || '(done)' : m.content }));
    saveDanteMessage('user', q);

    const controller = new AbortController();
    abortRef.current = controller;
    const speaker = makeSpeaker();
    let spokenUpTo = 0;
    let full = '';

    const speakReady = (final: boolean) => {
      const spoken = toSpeech(full);
      const rest = spoken.slice(spokenUpTo);
      // speak every complete sentence; on the final chunk speak whatever is left
      const m = final ? rest.length : (() => { let idx = -1; const re = /[.!?…](\s|$)/g; let r; while ((r = re.exec(rest))) idx = r.index + 1; return idx; })();
      if (m > 0) {
        speaker.speak(rest.slice(0, m));
        spokenUpTo += m;
      }
    };

    try {
      const token = await getAuthToken();
      const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '';
      full = await streamDante({
        messages: history,
        context: buildDanteContext(stateRef.current, googleEvents, name, lang, 'voice', isOffline),
        token,
        signal: controller.signal,
        onText: t => { full = t; setReply(visibleText(t)); speakReady(false); },
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const msg = err instanceof DanteRequestError ? err.message : 'Could not reach Dante. Check your connection.';
      setError(msg);
      setPhase('idle');
      return;
    }
    if (controller.signal.aborted) return;

    speakReady(true);
    speaker.finish();
    saveDanteMessage('assistant', full);
    const actions = parseActions(full);
    if (actions.length) setResults(await runDanteActions(actions, { stateRef, addTask, editTask, toggleTaskDone, addMeeting, updateState, rememberFact, forgetFact, confirmForgetFact }));
    if (!toSpeech(full)) speaker.finish();

    await speaker.done;
    if (speaker.isCurrent() && openRef.current) {
      setPhase('idle');
      setTimeout(listen, 250); // keep the conversation going
    }
  };

  // ---------- interrupt by voice (optional; best with headphones) ----------
  const loudSince = useRef(0);
  useEffect(() => {
    if (!prefs.bargeIn || phase !== 'speaking') { loudSince.current = 0; return; }
    if (level > 0.35) {
      if (!loudSince.current) loudSince.current = Date.now();
      else if (Date.now() - loudSince.current > 350) { loudSince.current = 0; stopSpeaking(); abortRef.current?.abort(); setPhase('idle'); listen(); }
    } else loudSince.current = 0;
  }, [level, phase, prefs.bargeIn]);

  // ---------- open / close ----------
  useEffect(() => {
    if (liveOpen) {
      setHeard(''); setReply(''); setResults([]); setError(null); setPaused(false);
      const t = setTimeout(listen, 350);
      return () => clearTimeout(t);
    }
    stopSpeaking();
    abortRef.current?.abort();
    mic.cancel();
    setPhase('idle');
  }, [liveOpen]);

  const close = () => setLiveOpen(false);

  /** Tap the orb (or press Space): interrupt Dante, or start/stop listening. */
  const tap = () => {
    if (phase === 'speaking' || phase === 'thinking') { stopSpeaking(); abortRef.current?.abort(); setPhase('idle'); listen(); }
    else if (phase === 'listening') mic.stop();
    else if (phase === 'idle') { setPaused(false); setTimeout(listen, 0); }
  };

  useEffect(() => {
    if (!liveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('select,input,button')) { e.preventDefault(); tap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const orbState: OrbState = phase === 'listening' ? 'listening' : phase === 'speaking' ? 'speaking' : phase === 'thinking' || phase === 'transcribing' ? 'thinking' : 'idle';
  const label =
    error ? 'Something went wrong'
    : paused ? 'Microphone paused'
    : phase === 'listening' ? 'Listening…'
    : phase === 'transcribing' ? 'Got it…'
    : phase === 'thinking' ? 'Thinking…'
    : phase === 'speaking' ? 'Speaking · tap to interrupt'
    : 'Tap the orb or press Space to talk';
  const noMic = !mic.supported;

  return (
    <AnimatePresence>
      {liveOpen && (
        <motion.div
          className="fixed inset-0 z-[95] flex flex-col text-white overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label="Dante Live"
        >
          {/* Ambient background that breathes with the conversation */}
          <div className="absolute inset-0 bg-[#07071a]" />
          <motion.div
            className="absolute left-1/2 top-1/2 w-[900px] h-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px] pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(91,95,239,.55), rgba(129,81,235,.35) 40%, rgba(6,182,212,.15) 65%, transparent 75%)' }}
            animate={reduce ? {} : { scale: phase === 'speaking' ? [1, 1.08, 1] : phase === 'listening' ? 1 + level * 0.25 : [1, 1.03, 1], opacity: phase === 'idle' ? 0.55 : 0.9 }}
            transition={phase === 'listening' ? { duration: 0.1 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Top bar */}
          <div className="relative flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2 text-white/80">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="font-semibold tracking-wide">Dante Live</span>
              {status?.model && <span className="text-[12px] text-white/50 hidden sm:inline">· {status.model}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSettings(s => !s)} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer" aria-label="Voice settings" aria-expanded={showSettings}>
                <Icon name="tune" className="text-[22px]" />
              </button>
              <button onClick={close} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer" aria-label="Close Dante Live">
                <Icon name="close" className="text-[22px]" />
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="relative mx-auto w-full max-w-md px-5">
              <div className="rounded-2xl bg-white/10 backdrop-blur-xl p-4 flex flex-col gap-3 text-[14px]">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-white/70">Language</span>
                  <select value={lang} onChange={e => setLang(e.target.value)} className="bg-white/10 rounded-lg px-2 py-1.5 outline-none">
                    {VOICE_LANGS.map(l => <option key={l.code} value={l.code} className="text-black">{l.label}</option>)}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-white/70">Voice</span>
                  <select value={prefs.voiceURI} onChange={e => setPrefs({ ...prefs, voiceURI: e.target.value })} className="bg-white/10 rounded-lg px-2 py-1.5 outline-none max-w-[220px]">
                    <option value="" className="text-black">Automatic</option>
                    {langVoices.map(v => <option key={v.voiceURI} value={v.voiceURI} className="text-black">{v.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-white/70">Speed</span>
                  <input type="range" min={0.8} max={1.4} step={0.05} value={prefs.rate} onChange={e => setPrefs({ ...prefs, rate: Number(e.target.value) })} className="w-40 accent-white" />
                </label>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-white/70">Interrupt by speaking <span className="text-white/40">(use headphones)</span></span>
                  <input type="checkbox" checked={prefs.bargeIn} onChange={e => setPrefs({ ...prefs, bargeIn: e.target.checked })} className="w-4 h-4 accent-white" />
                </label>
              </div>
            </div>
          )}

          {/* Centre: orb + captions */}
          <div className="relative flex-1 flex flex-col items-center justify-center gap-10 px-6">
            <button onClick={tap} className="rounded-full cursor-pointer focus-visible:outline-white" aria-label={label}>
              <DanteOrb size={190} state={orbState} level={phase === 'listening' ? level : 0} />
            </button>

            <div className="text-center max-w-2xl min-h-[140px] flex flex-col items-center gap-3" aria-live="polite">
              <div className={`text-[15px] font-medium ${error ? 'text-red-300' : 'text-white/60'}`}>{error || label}</div>
              {heard && <p className="text-white/50 text-[16px]">“{heard}”</p>}
              {reply && (
                <motion.p key={heard} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[20px] md:text-[24px] leading-snug font-medium text-white max-h-[30vh] overflow-y-auto">
                  {toSpeech(reply)}
                </motion.p>
              )}
              {results.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {results.map((r, i) => (
                    <span key={i} className={`flex items-center gap-1 px-3 py-1 rounded-full text-[13px] ${r.ok ? 'bg-emerald-400/15 text-emerald-200' : 'bg-red-400/15 text-red-200'}`}>
                      <Icon name={r.ok ? 'check_circle' : 'error'} className="text-[16px]" />{r.label}{r.detail ? ` — ${r.detail}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {noMic && <p className="text-red-300 text-[14px]">This browser can’t use the microphone here. Use Chrome or Edge on localhost or HTTPS.</p>}
            </div>
          </div>

          {/* Bottom controls */}
          <div className="relative flex items-center justify-center gap-4 pb-10 pt-4">
            <button
              onClick={() => { const p = !paused; setPaused(p); if (p) { mic.cancel(); setPhase('idle'); } else setTimeout(listen, 0); }}
              className={`w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-colors ${paused ? 'bg-white text-[#07071a]' : 'bg-white/10 hover:bg-white/20'}`}
              aria-label={paused ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={paused}
            >
              <Icon name={paused ? 'mic_off' : 'mic'} className="text-[26px]" />
            </button>
            <button onClick={close} className="h-14 px-7 rounded-full bg-red-500 hover:bg-red-600 flex items-center gap-2 font-semibold cursor-pointer" aria-label="End Dante Live">
              <Icon name="call_end" className="text-[24px]" />End
            </button>
          </div>
          <p className="relative text-center text-[12px] text-white/40 pb-4 hidden md:block">Space: talk / interrupt · Esc: close · Conversation is saved in the Dante chat</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
