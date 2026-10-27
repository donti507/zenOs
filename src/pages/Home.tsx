import {btn} from '../components/ui/kit';
import SpaceWidgets from '../components/SpaceWidgets';
import SnapSyllabus from '../components/SnapSyllabus';
import PostponedTasks from '../components/PostponedTasks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useZenos } from '../context/ZenosContext';
import { categoryTone, computeStreak, localDateStr, today } from '../lib/utils';
import { Task } from '../types';
import DanteOrb from '../components/DanteOrb';
import { useDanteStatus } from '../hooks/useDanteStatus';

// ---------- small date helpers ----------
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
};
const relDay = (date: string) => {
  if (!date) return '';
  if (date === today()) return 'Today';
  if (date === addDays(1)) return 'Tomorrow';
  if (date === addDays(-1)) return 'Yesterday';
  return new Date(date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return 'Link'; } };
const findMeetLink = (text = '') => text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] || text.match(/https?:\/\/\S+/)?.[0] || '';

type ScheduleItem = { key: string; date: string; time: string; title: string; subtitle: string; link: string; source: 'meeting' | 'google' };

const rank = (t: Task, todayStr: string) => (!t.date ? 3 : t.date < todayStr ? 0 : t.date === todayStr ? 1 : 2);

export default function Home() {
  const { state, user, googleEvents, toggleTaskDone, setShowModal, setEditTaskId, setLiveOpen } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const status = useDanteStatus();
  const [briefDismissed, setBriefDismissed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [justChecked, setJustChecked] = useState<Record<string, boolean>>({});

  const todayStr = today();
  const firstName = (user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').split(/\s+/)[0];
  const ask = (q: string) => navigate('/dante', { state: { prompt: q } });

  // ---------- derived data ----------
  const open = state.tasks.filter(t => t.status !== 'done');
  const overdue = open.filter(t => t.date && t.date < todayStr);
  const dueToday = open.filter(t => t.date === todayStr);
  const priority = [...open]
    .sort((a, b) => rank(a, todayStr) - rank(b, todayStr) || (a.date || '').localeCompare(b.date || ''))
    .slice(0, 6);
  const streak = computeStreak(state.completionLog);
  const catOf = (id: string) => state.categories.find(c => c.id === id);

  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(i - 6));
    const counts = days.map(d => state.completionLog.filter(l => l === d).length);
    const prev = Array.from({ length: 7 }, (_, i) => addDays(i - 13)).reduce((n, d) => n + state.completionLog.filter(l => l === d).length, 0);
    const total = counts.reduce((a, b) => a + b, 0);
    const change = prev ? Math.round(((total - prev) / prev) * 100) : null;
    return { days, counts, total, change };
  }, [state.completionLog, todayStr]);

  const schedule: ScheduleItem[] = useMemo(() => {
    const local: ScheduleItem[] = (state.meetings || [])
      .filter(m => m.status !== 'completed' && m.date >= todayStr)
      .map(m => ({ key: `m-${m.id}`, date: m.date, time: m.time, title: m.subject, subtitle: `With ${m.personName}`, link: findMeetLink(m.notes), source: 'meeting' }));
    const gcal: ScheduleItem[] = googleEvents
      .map((e: any) => {
        const start: string = e.start?.dateTime || e.start?.date || '';
        const date = start.slice(0, 10);
        return {
          key: `g-${e.id}`,
          date,
          time: e.start?.dateTime ? new Date(start).toTimeString().slice(0, 5) : 'All day',
          title: e.summary || 'Busy',
          subtitle: 'Google Calendar',
          link: e.hangoutLink || '',
          source: 'google' as const,
        };
      })
      .filter(e => e.date >= todayStr);
    // Skip Google events we already track as local meetings
    const seen = new Set(local.map(l => `${l.date}${l.time}${l.title}`));
    return [...local, ...gcal.filter(g => !seen.has(`${g.date}${g.time}${g.title}`))]
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .slice(0, 4);
  }, [state.meetings, googleEvents, todayStr]);
  const meetingsToday = schedule.filter(s => s.date === todayStr).length;

  // Dante's proactive suggestion, based on what actually needs attention
  const brief = overdue.length
    ? {
        text: <>You have <span className="font-medium text-primary">{overdue.length} overdue task{overdue.length > 1 ? 's' : ''}</span>. Want Dante to suggest new dates?</>,
        action: 'Reschedule',
        prompt: 'Look at my overdue tasks and suggest realistic new due dates this week. Ask me before changing anything.',
      }
    : schedule[0] && schedule[0].date === todayStr
      ? {
          text: <>Next up: <span className="font-medium text-primary">{schedule[0].title}</span> at {schedule[0].time}. Get a quick prep list?</>,
          action: 'Prepare me',
          prompt: `Help me prepare for "${schedule[0].title}" at ${schedule[0].time} today. Give me a short prep checklist based on my tasks.`,
        }
      : open.length
        ? { text: <>{open.length} open tasks and a clear calendar. Let Dante plan your day.</>, action: 'Plan my day', prompt: 'Plan my day: pick the 3 most important tasks and suggest an order.' }
        : { text: <>No open tasks. Tell Dante what you're working on and it will set things up.</>, action: 'Get started', prompt: 'Help me set up my tasks for this week. Ask me what I am working on.' };

  const suggestions = [
    'What should I focus on today?',
    overdue[0] ? `Help me finish “${overdue[0].title}”` : 'What is due this week?',
    'Summarize my week',
  ];

  const onCheck = (t: Task) => {
    setJustChecked(s => ({ ...s, [String(t.id)]: true }));
    setTimeout(() => toggleTaskDone(t.id), reduce ? 0 : 450);
  };

  const card = 'rounded-xl bg-surface-container-lowest shadow-soft';
  const enter = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay: i * 0.05, ease: 'easeOut' as const } };

  // Sparkline path from real completion counts
  const max = Math.max(1, ...week.counts);
  const pts = week.counts.map((c, i) => [i * 24, 42 - (c / max) * 36]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y.toFixed(1)}`).join(' ');

  return (
    <div className="flex flex-col w-full px-4 md:px-8 py-6 gap-8 max-w-[1440px] mx-auto">
      {/* Greeting + proactive brief */}
      <motion.section {...enter(0)} className={`relative overflow-hidden ${card} p-6 md:p-8`}>
        <div className="absolute -right-20 -top-24 h-96 w-96 rounded-full bg-gradient-to-br from-primary-container/15 via-tertiary-container/10 to-transparent blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="flex flex-col gap-2 max-w-3xl">
            <span className="text-[12px] text-on-surface-variant font-medium">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <h1 className="text-[26px] leading-[34px] md:text-[32px] md:leading-10 font-semibold tracking-tight text-on-surface">
              {greeting()}{firstName ? `, ${firstName}` : ''}.
            </h1>
            <p className="text-on-surface-variant">
              You have <strong className="text-on-surface font-medium">{dueToday.length} task{dueToday.length === 1 ? '' : 's'} due today</strong>
              {overdue.length > 0 && <>, <strong className="text-error font-medium">{overdue.length} overdue</strong></>}
              {' '}and <strong className="text-on-surface font-medium">{meetingsToday} meeting{meetingsToday === 1 ? '' : 's'}</strong> scheduled.
            </p>
            <div className="mt-2 flex flex-wrap gap-2"><SnapSyllabus /><button className={btn.secondary} onClick={()=>navigate('/focus-rooms')}>Focus with others</button></div>
            <div className="pt-1 flex flex-wrap items-center gap-3 text-[12px] text-on-surface-variant">
              <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
                <span className="material-symbols-outlined text-[16px] text-warning">local_fire_department</span>
                <span><strong className="text-on-surface font-semibold">{streak}-day</strong> completion streak</span>
              </div>
              <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
                <span className="material-symbols-outlined text-[16px] text-tertiary">task_alt</span>
                <span><strong className="text-on-surface font-semibold">{week.total}</strong> tasks done this week</span>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {!briefDismissed && (
              <motion.div
                exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
                className="xl:w-96 flex flex-col gap-1 bg-surface-container-low p-4 rounded-xl"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
                  <span className="text-[12px] font-semibold text-on-surface">Dante suggests</span>
                </div>
                <p className="text-on-surface leading-snug">{brief.text}</p>
                <div className="pt-1 flex items-center justify-end gap-2">
                  <button className="px-2.5 py-1 text-on-surface-variant hover:text-on-surface text-[12px] cursor-pointer" type="button" onClick={() => setBriefDismissed(true)}>Dismiss</button>
                  <button className="px-3 py-1 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:opacity-90 transition shadow-sm cursor-pointer active:scale-[0.97]" type="button" onClick={() => ask(brief.prompt)}>
                    {brief.action}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>

      <SpaceWidgets />
      <PostponedTasks />

      {/* Dante command center */}
      <motion.section {...enter(1)} className={`relative overflow-hidden ${card} p-6`}>
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6 w-full lg:w-auto">
            <DanteOrb size={64} />
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-semibold tracking-tight text-on-surface">Dante</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${status && !status.ready ? 'bg-error-container text-error' : 'bg-surface-container-high text-primary'}`}>
                  {status ? (status.ready ? 'Ready' : 'Not configured') : 'Connecting…'}
                </span>
              </div>
              <p className="text-[12px] text-on-surface-variant max-w-sm">
                {status && !status.ready
                  ? status.problem
                  : 'Knows your tasks, meetings and calendar. Ask in text or by voice, and it can make changes for you.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
            {[
              { icon: 'calendar_clock', tone: 'text-primary', title: 'Plan my day', sub: 'Top 3 tasks, in order', q: 'Plan my day: pick the 3 most important tasks and suggest an order with time estimates.' },
              { icon: 'graphic_eq', tone: 'text-tertiary', title: 'Go Live', sub: 'Talk hands-free', voice: true },
            ].map(a => (
              <button
                key={a.title}
                type="button"
                onClick={() => (a.voice ? setLiveOpen(true) : ask(a.q!))}
                className="group flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container transition-all text-left cursor-pointer active:scale-[0.98]"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`material-symbols-outlined text-[18px] ${a.tone}`}>{a.icon}</span>
                  <div>
                    <div className="font-medium text-on-surface leading-none">{a.title}</div>
                    <div className="text-[11px] text-on-surface-variant mt-1">{a.sub}</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[16px] text-outline group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 bg-surface-container-low/60 rounded-xl p-4">
          <form
            className="relative flex items-center"
            onSubmit={e => {
              e.preventDefault();
              if (prompt.trim()) ask(prompt.trim());
            }}
          >
            <span className="material-symbols-outlined absolute left-3.5 text-[20px] text-primary">psychology_alt</span>
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full h-11 pl-11 pr-24 bg-surface-container-lowest rounded-xl text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all"
              placeholder="Ask Dante about your tasks, meetings or calendar…"
              aria-label="Ask Dante"
            />
            <button type="submit" disabled={!prompt.trim()} className="absolute right-2 h-8 px-3 rounded-lg bg-primary-container text-on-primary-container text-[12px] font-semibold hover:bg-primary hover:text-on-primary transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50">
              Send<span className="material-symbols-outlined text-[14px]">arrow_upward</span>
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
            <span className="text-on-surface-variant font-medium">Try:</span>
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => ask(s)} className="px-2.5 py-1 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors cursor-pointer">
                {s}
              </button>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Priority tasks */}
        <motion.div {...enter(2)} className="xl:col-span-7 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">task_alt</span>
              <h2 className="text-[16px] font-semibold text-on-surface">Priority tasks</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="text-[12px] text-on-surface-variant hover:text-on-surface transition-colors px-2 py-1 rounded-md bg-surface-container-low cursor-pointer" type="button" onClick={() => navigate('/tasks')}>
                View all ({open.length})
              </button>
              <button className="text-[12px] font-semibold text-primary hover:opacity-80 transition flex items-center gap-1 cursor-pointer" type="button" onClick={() => setShowModal('addTask')}>
                <span className="material-symbols-outlined text-[16px]">add_circle</span> Add task
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {priority.length === 0 && (
              <div className={`${card} p-8 text-center flex flex-col items-center gap-2`}>
                <span className="material-symbols-outlined text-[32px] text-success">celebration</span>
                <div className="font-medium text-on-surface">You're all caught up</div>
                <p className="text-[12px] text-on-surface-variant">Add a task, or ask Dante to plan the rest of your week.</p>
              </div>
            )}
            <AnimatePresence initial={false}>
              {priority.map(t => {
                const cat = catOf(t.cat);
                const tone = categoryTone(cat);
                const checked = justChecked[String(t.id)];
                const isOverdue = t.date && t.date < todayStr;
                const steps = t.steps || [];
                return (
                  <motion.div
                    key={String(t.id)}
                    layout={!reduce}
                    exit={reduce ? undefined : { opacity: 0, x: 24, transition: { duration: 0.2 } }}
                    className={`group relative flex items-start gap-4 p-4 ${card} hover:-translate-y-0.5 hover:shadow-md transition-all duration-200`}
                  >
                    <button
                      className={`mt-0.5 shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer ${checked ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-transparent hover:text-primary'}`}
                      style={checked && !reduce ? { animation: 'check-pop .35s ease-out' } : undefined}
                      onClick={() => onCheck(t)}
                      type="button"
                      aria-label={`Mark “${t.title}” as done`}
                    >
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => { setEditTaskId(t.id); setShowModal('editTask'); }}
                          className={`font-medium text-on-surface text-left hover:text-primary transition-colors cursor-pointer ${checked ? 'line-through opacity-50' : ''}`}
                        >
                          {t.title}
                        </button>
                        <div className="flex items-center gap-1.5">
                          {isOverdue ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-error text-[11px] font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-error" /> Overdue · {relDay(t.date)}
                            </span>
                          ) : t.date === todayStr ? (
                            <span className="px-2 py-0.5 rounded-full bg-warning-container text-warning text-[11px] font-semibold">Due today</span>
                          ) : t.date ? (
                            <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[11px] font-medium">{relDay(t.date)}</span>
                          ) : null}
                          {cat && <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${tone.chip}`}>{cat.label}</span>}
                        </div>
                      </div>
                      {t.note && <p className="text-[12px] text-on-surface-variant line-clamp-2">{t.note}</p>}
                      {(t.progress > 0 || steps.length > 0 || t.status === 'inprogress') && (
                        <div className="flex items-center gap-4 pt-1 text-[12px] text-on-surface-variant">
                          {t.status === 'inprogress' && <span className="flex items-center gap-1 text-primary font-medium"><span className="material-symbols-outlined text-[14px]">pending</span> In progress</span>}
                          {steps.length > 0 && <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">checklist</span> {steps.filter(s => s.done).length}/{steps.length} steps</span>}
                          {t.progress > 0 && (
                            <span className="flex items-center gap-2 flex-1 max-w-[160px]">
                              <span className="h-1.5 flex-1 rounded-full bg-surface-container-high overflow-hidden"><span className="block h-full rounded-full bg-primary" style={{ width: `${t.progress}%` }} /></span>
                              {t.progress}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => ask(`Help me get “${t.title}” done. Break it into small next steps.`)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-on-surface-variant hover:text-primary cursor-pointer"
                      aria-label={`Ask Dante about “${t.title}”`}
                      title="Ask Dante"
                    >
                      <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Weekly throughput */}
          <div className={`p-4 ${card} flex items-center justify-between gap-4`}>
            <div>
              <span className="text-[12px] font-semibold text-on-surface">This week</span>
              <div className="text-[24px] leading-8 font-semibold tracking-tight text-on-surface">{week.total} done</div>
              <span className="text-[11px] text-on-surface-variant">
                {week.change === null ? `${open.length} still open` : `${week.change >= 0 ? '+' : ''}${week.change}% vs last week · ${open.length} still open`}
              </span>
            </div>
            <svg className="w-36 h-12 text-primary shrink-0" fill="none" viewBox="0 0 144 48" role="img" aria-label={`Tasks completed per day: ${week.counts.join(', ')}`}>
              <path d={`${line} V48 H0 Z`} fill="currentColor" fillOpacity="0.08" />
              <path d={line} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
            </svg>
          </div>
        </motion.div>

        {/* Right column */}
        <motion.div {...enter(3)} className="xl:col-span-5 flex flex-col gap-4">
          {/* Schedule */}
          <div className={`p-4 ${card} flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-tertiary">videocam</span>
                <h2 className="text-[16px] font-semibold text-on-surface">Up next</h2>
              </div>
              <button className="text-[12px] text-primary hover:underline cursor-pointer" type="button" onClick={() => navigate('/meetings')}>All meetings</button>
            </div>

            {schedule.length === 0 ? (
              <div className="p-4 rounded-xl bg-surface-container-low text-center flex flex-col items-center gap-2">
                <span className="text-on-surface-variant text-[12px]">Nothing scheduled. Enjoy the focus time.</span>
                <button className="text-[12px] font-semibold text-primary cursor-pointer" onClick={() => navigate('/meetings')}>Schedule a meeting</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {schedule.map((s, i) =>
                  i === 0 ? (
                    <div key={s.key} className="p-4 rounded-xl bg-surface-container-low flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[12px] font-semibold">
                          {s.date === todayStr && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                          {relDay(s.date)} · {s.time}
                        </span>
                        <span className="text-[11px] text-on-surface-variant font-medium">{s.source === 'google' ? 'Google Calendar' : 'Meeting'}</span>
                      </div>
                      <div>
                        <div className="text-[15px] font-semibold text-on-surface">{s.title}</div>
                        <div className="text-[12px] text-on-surface-variant mt-0.5">{s.subtitle}</div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        {s.link && (
                          <a href={s.link} target="_blank" rel="noopener noreferrer" className="flex-1 py-1.5 px-3 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:opacity-90 transition shadow-sm flex items-center justify-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px]">call</span>Join call
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => ask(`Help me prepare for "${s.title}" (${relDay(s.date)} at ${s.time}). Give me a short prep checklist.`)}
                          className="flex-1 py-1.5 px-3 rounded-lg bg-surface-container-lowest text-on-surface text-[12px] hover:bg-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>Prep with Dante
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={s.key} className="p-4 rounded-xl bg-surface-container-low/50 hover:bg-surface-container-low transition-colors flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-on-surface-variant font-medium">{relDay(s.date)} · {s.time}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">{s.source === 'google' ? 'Google' : 'Meeting'}</span>
                      </div>
                      <div className="font-medium text-on-surface">{s.title}</div>
                      <div className="text-[12px] text-on-surface-variant">{s.subtitle}</div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Vault */}
          <div className={`p-4 ${card} flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">folder_special</span>
                <h2 className="text-[16px] font-semibold text-on-surface">Vault</h2>
              </div>
              <button className="text-[12px] text-primary hover:underline cursor-pointer" type="button" onClick={() => navigate('/vault')}>Open vault</button>
            </div>
            {state.vault.length === 0 ? (
              <p className="text-[12px] text-on-surface-variant">Save links and files here so Dante can point you to them.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {state.vault.slice(0, 4).map(v => {
                  const icon = v.type === 'file' ? (v.fileType?.includes('pdf') ? 'picture_as_pdf' : v.fileType?.includes('audio') ? 'audio_file' : 'description') : 'link';
                  const Tag: any = v.url ? 'a' : 'div';
                  return (
                    <Tag key={v.id} {...(v.url ? { href: v.url, target: '_blank', rel: 'noopener noreferrer' } : {})} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-low transition-colors group">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
                        <div className="min-w-0">
                          <span className="text-on-surface truncate font-medium group-hover:text-primary transition-colors block">{v.name}</span>
                          <span className="text-[11px] text-on-surface-variant truncate block">{v.detail || (v.url ? hostOf(v.url) : 'File')}</span>
                        </div>
                      </div>
                      {v.url && <span className="material-symbols-outlined text-[18px] text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">open_in_new</span>}
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
