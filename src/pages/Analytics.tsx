import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { addDaysStr, computeStreak, categoryTone, today } from '../lib/utils';
import { PageHeader, Icon, Segmented, btn, card } from '../components/ui/kit';
import DanteOrb from '../components/DanteOrb';

export default function Analytics() {
  const { state } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [range, setRange] = useState<'7' | '30'>('7');
  const days = Number(range);
  const todayStr = today();
  const log = state.completionLog;

  const data = useMemo(() => {
    const series = Array.from({ length: days }, (_, i) => {
      const date = addDaysStr(i - days + 1);
      return { date, count: log.filter(d => d === date).length };
    });
    const prev = Array.from({ length: days }, (_, i) => addDaysStr(i - 2 * days + 1)).reduce((n, d) => n + log.filter(x => x === d).length, 0);
    const total = series.reduce((n, s) => n + s.count, 0);
    const open = state.tasks.filter(t => t.status !== 'done');
    const overdue = open.filter(t => t.date && t.date < todayStr).length;
    const done = state.tasks.filter(t => t.status === 'done').length;
    const best = Math.max(0, ...series.map(s => s.count));
    const cats = state.categories
      .map(c => ({ cat: c, open: open.filter(t => t.cat === c.id).length, done: state.tasks.filter(t => t.cat === c.id && t.status === 'done').length }))
      .filter(c => c.open + c.done > 0);
    const meetingMinutes = Math.round((state.meetings || []).reduce((n, m) => n + (m.elapsedSeconds || 0), 0) / 60);
    return { series, total, prev, open: open.length, overdue, done, best, cats, meetingMinutes, rate: Math.round((done / Math.max(1, state.tasks.length)) * 100) };
  }, [log, state.tasks, state.categories, state.meetings, days, todayStr]);

  const streak = computeStreak(log);
  const change = data.prev ? Math.round(((data.total - data.prev) / data.prev) * 100) : null;
  const max = Math.max(1, ...data.series.map(s => s.count));

  // 12-week heatmap (columns = weeks, Monday first)
  const heat = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 7 * 11 - ((end.getDay() + 6) % 7));
    const counts = new Map<string, number>();
    log.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
    return Array.from({ length: 12 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const x = new Date(start);
        x.setDate(start.getDate() + w * 7 + d);
        const key = addDaysStr(0, x);
        return { key, n: counts.get(key) || 0, future: key > todayStr };
      })
    );
  }, [log, todayStr]);
  const heatLevel = (n: number) => (n === 0 ? 'bg-surface-container-high' : n === 1 ? 'bg-primary/30' : n <= 3 ? 'bg-primary/60' : 'bg-primary');

  // Donut segments
  const totalCat = data.cats.reduce((n, c) => n + c.open + c.done, 0) || 1;
  let acc = 0;
  const segments = data.cats.map(c => {
    const frac = (c.open + c.done) / totalCat;
    const seg = { ...c, frac, offset: acc };
    acc += frac;
    return seg;
  });

  const stats = [
    { icon: 'task_alt', tone: 'text-success', label: `Done (${days} days)`, value: data.total, sub: change === null ? 'No earlier data' : `${change >= 0 ? '+' : ''}${change}% vs previous ${days} days` },
    { icon: 'local_fire_department', tone: 'text-warning', label: 'Current streak', value: `${streak}d`, sub: streak ? 'Keep it going' : 'Complete a task today to start one' },
    { icon: 'pending_actions', tone: 'text-primary', label: 'Open tasks', value: data.open, sub: data.overdue ? `${data.overdue} overdue` : 'Nothing overdue' },
    { icon: 'timer', tone: 'text-tertiary', label: 'Meeting time', value: `${data.meetingMinutes}m`, sub: (n => `${n} meeting${n === 1 ? '' : 's'} logged`)((state.meetings || []).filter(m => m.status === 'completed').length) },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="How your week is going, from your real completions."
        actions={<Segmented label="Range" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`${card} p-4`}>
            <div className="flex items-center gap-2 text-[12px] text-on-surface-variant font-medium"><Icon name={s.icon} className={`text-[18px] ${s.tone}`} />{s.label}</div>
            <div className="text-[28px] leading-9 font-semibold tracking-tight text-on-surface mt-1">{s.value}</div>
            <div className={`text-[12px] ${s.label === 'Open tasks' && data.overdue ? 'text-error' : 'text-on-surface-variant'}`}>{s.sub}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
        {/* Bar chart */}
        <section className={`${card} p-5 xl:col-span-2`} aria-label="Completed tasks per day">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-on-surface">Completed per day</h2>
            <span className="text-[12px] text-on-surface-variant">Best day: {data.best}</span>
          </div>
          <div className="flex items-end gap-1.5 h-48" role="img" aria-label={data.series.map(s => `${s.date}: ${s.count}`).join(', ')}>
            {data.series.map((s, i) => (
              <div key={s.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                <span className="text-[11px] text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">{s.count}</span>
                <motion.div
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: `${Math.max(s.count ? 6 : 2, (s.count / max) * 100)}%` }}
                  transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.02, ease: 'easeOut' }}
                  className={`w-full rounded-md ${s.date === todayStr ? 'bg-primary' : s.count ? 'bg-primary/50 group-hover:bg-primary/70' : 'bg-surface-container-high'}`}
                />
                {(days === 7 || i % 5 === 0 || i === days - 1) && (
                  <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
                    {new Date(s.date + 'T00:00').toLocaleDateString('en-GB', days === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Category donut */}
        <section className={`${card} p-5`} aria-label="Tasks by category">
          <h2 className="font-semibold text-on-surface mb-4">By category</h2>
          {segments.length === 0 ? (
            <p className="text-[13px] text-on-surface-variant py-10 text-center">No tasks yet.</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-36 h-36">
                <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
                  <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--z-sc-high)" strokeWidth="5" />
                  {segments.map(s => (
                    <circle key={s.cat.id} cx="21" cy="21" r="15.9" fill="none" stroke={categoryTone(s.cat).hex} strokeWidth="5"
                      strokeDasharray={`${s.frac * 100 - 0.8} ${100 - s.frac * 100 + 0.8}`} strokeDashoffset={-s.offset * 100} pathLength={100} />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[22px] font-semibold text-on-surface">{data.rate}%</span>
                  <span className="text-[11px] text-on-surface-variant">complete</span>
                </div>
              </div>
              <ul className="w-full flex flex-col gap-2">
                {segments.map(s => (
                  <li key={s.cat.id} className="flex items-center gap-2 text-[13px]">
                    <span className={`w-2.5 h-2.5 rounded-full ${categoryTone(s.cat).dot}`} />
                    <span className="flex-1 text-on-surface">{s.cat.label}</span>
                    <span className="text-on-surface-variant">{s.done}/{s.open + s.done} done</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Heatmap */}
        <section className={`${card} p-5 xl:col-span-2 overflow-x-auto`} aria-label="Activity over the last 12 weeks">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-on-surface">Last 12 weeks</h2>
            <div className="flex items-center gap-1 text-[11px] text-on-surface-variant">Less
              {[0, 1, 2, 4].map(n => <span key={n} className={`w-3 h-3 rounded-[3px] ${heatLevel(n)}`} />)}More
            </div>
          </div>
          <div className="flex gap-1">
            <div className="flex flex-col gap-1 mr-1 text-[10px] text-on-surface-variant">
              {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d, i) => <span key={i} className="h-3.5 leading-[14px]">{d}</span>)}
            </div>
            {heat.map((week, w) => (
              <div key={w} className="flex flex-col gap-1">
                {week.map(c => (
                  <span key={c.key} title={`${c.key}: ${c.n} completed`} className={`w-3.5 h-3.5 rounded-[3px] ${c.future ? 'opacity-0' : heatLevel(c.n)} ${c.key === todayStr ? 'ring-1 ring-on-surface' : ''}`} />
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Dante insight */}
        <section className={`${card} p-5 flex flex-col gap-3`}>
          <div className="flex items-center gap-3">
            <DanteOrb size={36} />
            <h2 className="font-semibold text-on-surface">Insight from Dante</h2>
          </div>
          <p className="text-[13px] text-on-surface-variant">
            {data.overdue
              ? `${data.overdue} task${data.overdue > 1 ? 's are' : ' is'} overdue. Dante can suggest new dates or break them into smaller steps.`
              : data.total
                ? `You finished ${data.total} task${data.total > 1 ? 's' : ''} in the last ${days} days${change !== null ? ` (${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}%)` : ''}. Ask Dante what's working and what to focus on next.`
                : 'No completions in this period yet. Ask Dante to help you pick a small first win.'}
          </p>
          <button
            className={`${btn.primary} self-start`}
            onClick={() => navigate('/dante', { state: { prompt: `Analyse my productivity over the last ${days} days: I completed ${data.total} tasks (previous period ${data.prev}), streak ${streak} days, ${data.open} open and ${data.overdue} overdue. Give me 3 specific suggestions.` } })}
          >
            <Icon name="auto_awesome" className="text-[18px]" />Get suggestions
          </button>
        </section>
      </div>
    </div>
  );
}
