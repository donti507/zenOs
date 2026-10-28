import {tr,useUiLanguage,uiLocale} from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { Meeting } from '../types';
import { fmtDuration, relDay, today } from '../lib/utils';
import { PageHeader, Icon, Segmented, EmptyState, Modal, Field, btn, card, input, textarea } from '../components/ui/kit';

const ACTIVE_KEY = 'zenos_active_meeting';
const linkIn = (text = '') => text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] || text.match(/https?:\/\/\S+/)?.[0] || '';

type Saved = { id: string; elapsed: number; startedAt: number | null; notes: string };
const restore = (): Saved | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Saved;
    return { ...a, elapsed: a.startedAt ? Math.floor((Date.now() - a.startedAt) / 1000) : a.elapsed };
  } catch {
    return null;
  }
};

export default function Meetings() {
  useUiLanguage();
  const { state, addMeeting, updateMeeting, deleteMeeting, setShowModal, googleConnected } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const meetings = state.meetings || [];
  const todayStr = today();

  // ---------- live session (survives page changes via localStorage) ----------
  const [saved] = useState(restore);
  const [activeId, setActiveId] = useState<string | null>(saved?.id ?? null);
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0);
  const [ticking, setTicking] = useState(!!saved?.startedAt);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = meetings.find(m => m.id === activeId) || null;

  useEffect(() => {
    if (!ticking || !activeId) return;
    const startedAt = Date.now() - elapsed * 1000;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [ticking, activeId]);

  useEffect(() => {
    try {
      if (!activeId) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: activeId, elapsed, startedAt: ticking ? Date.now() - elapsed * 1000 : null, notes }));
    } catch { /* ignore */ }
  }, [activeId, ticking, notes, Math.floor(elapsed / 10)]);

  // If the active meeting was deleted elsewhere, drop the session
  useEffect(() => { if (activeId && meetings.length && !active) { setActiveId(null); setTicking(false); } }, [meetings, activeId]);

  const start = (m: Meeting) => {
    if (activeId && activeId !== m.id) updateMeeting(activeId, { elapsedSeconds: elapsed, notes });
    setActiveId(m.id);
    setElapsed(m.elapsedSeconds || 0);
    setNotes(m.notes || '');
    setTicking(true);
    updateMeeting(m.id, { status: 'ongoing' });
  };
  const pause = () => { setTicking(false); if (activeId) updateMeeting(activeId, { elapsedSeconds: elapsed, notes }); };
  const end = () => {
    if (!activeId) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    updateMeeting(activeId, { status: 'completed', elapsedSeconds: elapsed, notes });
    setTicking(false);
    setActiveId(null);
    setElapsed(0);
    setNotes('');
  };
  const onNotes = (txt: string) => {
    setNotes(txt);
    if (!activeId) return;
    const id = activeId;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => updateMeeting(id, { notes: txt, elapsedSeconds: elapsed }), 1200);
  };
  const remove = (id: string) => {
    if (!confirm(tr("Delete this meeting?"))) return;
    if (id === activeId) { setActiveId(null); setTicking(false); }
    deleteMeeting(id);
  };

  // ---------- new local meeting ----------
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ personName: '', subject: '', date: todayStr, time: '10:00' });
  const [formError, setFormError] = useState('');
  const create = async () => {
    if (!form.subject.trim() || !form.personName.trim() || !form.date || !form.time) return setFormError('Fill in every field.');
    const m = await addMeeting({ ...form, subject: form.subject.trim(), personName: form.personName.trim(), status: 'upcoming', elapsedSeconds: 0, notes: '' });
    if (!m) return setFormError('Could not save the meeting. Try again.');
    setFormOpen(false);
    setForm({ personName: '', subject: '', date: todayStr, time: '10:00' });
    setFormError('');
  };

  // ---------- lists ----------
  const [tab, setTab] = useState<'upcoming' | 'completed'>('upcoming');
  const upcoming = meetings.filter(m => m.status !== 'completed' && m.id !== activeId).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const completed = meetings.filter(m => m.status === 'completed').sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const list = tab === 'upcoming' ? upcoming : completed;
  const totalMinutes = Math.round(completed.reduce((n, m) => n + (m.elapsedSeconds || 0), 0) / 60);

  // ---------- focus timer ----------
  const [focus, setFocus] = useState(0);
  const [focusOn, setFocusOn] = useState(false);
  useEffect(() => {
    if (!focusOn) return;
    const startedAt = Date.now() - focus * 1000;
    const iv = setInterval(() => setFocus(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [focusOn]);

  const ask = (prompt: string) => navigate('/dante', { state: { prompt } });

  return (
    <div>
      <PageHeader
        title={tr("Meetings")}
        subtitle={tr("{{0}} upcoming · {{1}} min logged",upcoming.length,totalMinutes)}
        actions={
          <>
            {googleConnected && <button className={btn.secondary} onClick={() => setShowModal('scheduleMeeting')}><Icon name="video_call" className="text-[18px]" />{tr("Google meeting")}</button>}
            <button className={btn.primary} onClick={() => setFormOpen(true)}><Icon name="add" className="text-[18px]" />{tr("New meeting")}</button>
          </>
        }
      />

      {/* Live session */}
      <AnimatePresence>
        {active && (
          <motion.section
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            className="mb-6 rounded-2xl overflow-hidden bg-gradient-to-br from-[#2b2d7a] via-[#3b2a85] to-[#1d4b66] text-white shadow-lg"
            aria-label={tr("Live meeting")}
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr]">
              <div className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-[12px] font-semibold">
                  <span className={`w-2 h-2 rounded-full ${ticking ? 'bg-red-400 animate-pulse' : 'bg-white/50'}`} />
                  {ticking ? tr("Live") : tr("Paused")}
                </div>
                <div>
                  <h2 className="text-[22px] font-semibold leading-tight">{active.subject}</h2>
                  <p className="text-white/70">{tr("With ")}{active.personName}</p>
                </div>
                <div className="text-[48px] md:text-[56px] font-semibold tabular-nums tracking-tight leading-none" aria-live="off">{fmtDuration(elapsed)}</div>
                <div className="flex flex-wrap gap-2">
                  {ticking ? (
                    <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 font-medium cursor-pointer" onClick={pause}><Icon name="pause" className="text-[18px]" />{tr("Pause")}</button>
                  ) : (
                    <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 font-medium cursor-pointer" onClick={() => setTicking(true)}><Icon name="play_arrow" className="text-[18px]" />{tr("Resume")}</button>
                  )}
                  <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 font-medium cursor-pointer" onClick={end}><Icon name="call_end" className="text-[18px]" />{tr("End")}</button>
                  {linkIn(active.notes) && (
                    <a href={linkIn(active.notes)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-[#2b2d7a] font-medium"><Icon name="videocam" className="text-[18px]" />{tr("Open call")}</a>
                  )}
                </div>
              </div>
              <div className="p-4 lg:p-6 bg-black/15 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold">{tr("Live notes")}</span>
                  <span className="text-[11px] text-white/60">{tr("Saved automatically")}</span>
                </div>
                <textarea
                  value={notes}
                  onChange={e => onNotes(e.target.value)}
                  placeholder={tr("Decisions, action items, follow-ups…")}
                  className="flex-1 min-h-[160px] w-full p-3 rounded-xl bg-white/10 placeholder:text-white/50 text-white outline-none focus:ring-2 focus:ring-white/30 resize-none"
                  aria-label={tr("Meeting notes")}
                />
                <button
                  disabled={!notes.trim()}
                  onClick={() => ask(tr("Summarize these notes from my meeting \"{{0}}\" with {{1}}. List decisions and action items, and offer to create tasks for the action items.\n\n{{2}}",active.subject,active.personName,notes))}
                  className="self-end inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-[13px] font-medium cursor-pointer disabled:opacity-40"
                >
                  <Icon name="auto_awesome" className="text-[16px]" />{tr("Summarize with Dante")}</button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        <section>
          <div className="mb-3">
            <Segmented label={tr("Meetings")} value={tab} onChange={setTab} options={[{ value: 'upcoming', label: tr("Upcoming ({{0}})",upcoming.length) }, { value: 'completed', label: tr("Completed ({{0}})",completed.length) }]} />
          </div>

          {list.length === 0 ? (
            <div className={card}>
              <EmptyState
                icon={tab === 'upcoming' ? 'event_available' : 'history'}
                title={tab === 'upcoming' ? tr("No upcoming meetings") : tr("No completed meetings yet")}
                text={tab === 'upcoming' ? tr("Add one here, or ask Dante: “schedule a sync with Anna tomorrow at 10”.") : tr("Start a meeting to track its time and notes.")}
                action={tab === 'upcoming' && <button className={btn.primary} onClick={() => setFormOpen(true)}>{tr("New meeting")}</button>}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {list.map(m => {
                  const link = linkIn(m.notes);
                  const isToday = m.date === todayStr;
                  const past = m.status !== 'completed' && m.date < todayStr;
                  return (
                    <motion.article key={m.id} layout={!reduce} exit={reduce ? undefined : { opacity: 0, x: 20 }} className={`group ${card} p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:shadow-md transition-shadow`}>
                      <div className={`w-14 shrink-0 rounded-xl text-center py-2 ${isToday ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>
                        <div className="text-[11px] font-semibold uppercase opacity-80">{new Date(m.date + 'T00:00').toLocaleDateString(uiLocale(), { month: 'short' })}</div>
                        <div className="text-[20px] font-semibold leading-6">{new Date(m.date + 'T00:00').getDate()}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-on-surface truncate">{m.subject}</div>
                        <div className="text-[12px] text-on-surface-variant flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                          <span className="flex items-center gap-1"><Icon name="schedule" className="text-[14px]" />{relDay(m.date)} · {m.time}</span>
                          <span className="flex items-center gap-1"><Icon name="person" className="text-[14px]" />{m.personName}</span>
                          {m.status === 'completed' && <span className="flex items-center gap-1"><Icon name="timer" className="text-[14px]" />{fmtDuration(m.elapsedSeconds || 0)}</span>}
                          {past && <span className="text-warning font-medium">{tr("Missed?")}</span>}
                          {m.googleEventId && <span className="flex items-center gap-1"><Icon name="event" className="text-[14px]" />{tr("Google")}</span>}
                        </div>
                        {m.status === 'completed' && m.notes && <p className="text-[12px] text-on-surface-variant mt-1 line-clamp-2">{m.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {m.status !== 'completed' ? (
                          <>
                            {link && <a href={link} target="_blank" rel="noopener noreferrer" className={btn.secondary}><Icon name="call" className="text-[16px]" />{tr("Join")}</a>}
                            <button className={btn.solid} onClick={() => start(m)}><Icon name="play_arrow" className="text-[18px]" />{tr("Start")}</button>
                            <button className={btn.icon} title={tr("Prep with Dante")} aria-label={tr("Prep for {{0}} with Dante",m.subject)} onClick={() => ask(tr("Help me prepare for \"{{0}}\" with {{1}} ({{2}} at {{3}}). Give me a short agenda and prep checklist based on my tasks.",m.subject,m.personName,relDay(m.date),m.time))}>
                              <Icon name="auto_awesome" className="text-[18px] text-primary" />
                            </button>
                          </>
                        ) : (
                          m.notes && (
                            <button className={btn.secondary} onClick={() => ask(tr("Summarize my notes from \"{{0}}\" with {{1}}, list action items and offer to create tasks:\n\n{{2}}",m.subject,m.personName,m.notes))}>
                              <Icon name="auto_awesome" className="text-[16px] text-primary" />{tr("Summarize")}</button>
                          )
                        )}
                        <button className={`${btn.icon} opacity-60 group-hover:opacity-100`} aria-label={tr("Delete {{0}}",m.subject)} onClick={() => remove(m.id)}><Icon name="delete" className="text-[18px]" /></button>
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Focus timer */}
        <aside className={`${card} p-5 flex flex-col items-center gap-3 xl:sticky xl:top-20`} aria-label={tr("Focus timer")}>
          <div className="self-start">
            <h2 className="font-semibold text-on-surface">{tr("Focus timer")}</h2>
            <p className="text-[12px] text-on-surface-variant">{tr("Track a work block outside meetings.")}</p>
          </div>
          <div className="relative w-40 h-40 my-2">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--z-sc-high)" strokeWidth="6" />
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--z-primary)" strokeWidth="6" strokeLinecap="round" opacity={focus ? 1 : 0}
                strokeDasharray={`${((focus % 3600) / 3600) * 276.5} 276.5`} className="transition-[stroke-dasharray] duration-500" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[24px] font-semibold tabular-nums text-on-surface">{fmtDuration(focus)}</span>
              <span className="text-[11px] text-on-surface-variant">{focusOn ? tr("Focusing") : focus ? tr("Paused") : tr("Ready")}</span>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <button className={`${btn.solid} flex-1`} onClick={() => setFocusOn(o => !o)}><Icon name={focusOn ? 'pause' : 'play_arrow'} className="text-[18px]" />{focusOn ? tr("Pause") : tr("Start")}</button>
            <button className={btn.secondary} onClick={() => { setFocusOn(false); setFocus(0); }} disabled={!focus}><Icon name="restart_alt" className="text-[18px]" />{tr("Reset")}</button>
          </div>
        </aside>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={tr("New meeting")}
        width={460}
        footer={<><button className={btn.ghost} onClick={() => setFormOpen(false)}>{tr("Cancel")}</button><button className={btn.solid} onClick={create}>{tr("Add meeting")}</button></>}
      >
        <Field label={tr("Subject")}><input className={input} value={form.subject} placeholder={tr("e.g. Thesis check-in")} onChange={e => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field label={tr("With")}><input className={input} value={form.personName} placeholder={tr("Name or team")} onChange={e => setForm({ ...form, personName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("Date")}><input type="date" className={input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={tr("Time")}><input type="time" className={input} value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></Field>
        </div>
        {formError && <p className="text-[13px] text-error" role="alert">{tr(formError)}</p>}
        <p className="text-[12px] text-on-surface-variant">{tr("Tip: paste a video link into the notes later and a Join button appears.")}</p>
      </Modal>
    </div>
  );
}
