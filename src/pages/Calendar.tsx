import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { localDateStr, today, categoryTone, relDay } from '../lib/utils';
import { PageHeader, Icon, Segmented, btn, card } from '../components/ui/kit';

type Item = { key: string; taskId?: string | number; kind: 'task' | 'meeting' | 'google'; title: string; time?: string; done?: boolean; color: string; onClick?: () => void; link?: string };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Calendar() {
  const { state, updateState, googleEvents, loadingEvents, accessToken, isOffline, loginWithGoogle, setShowModal, setEditTaskId, toggleTaskDone } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selected, setSelected] = useState(today());
  const { calYear, calMonth } = state;
  const todayStr = today();

  // All items keyed by YYYY-MM-DD
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (d: string, it: Item) => { if (!d) return; map.set(d, [...(map.get(d) || []), it]); };
    state.tasks.forEach(t => {
      const cat = state.categories.find(c => c.id === t.cat);
      push(t.date, { key: `t${t.id}`, taskId: t.id, kind: 'task', title: t.title, done: t.status === 'done', color: categoryTone(cat).hex, onClick: () => { setEditTaskId(t.id); setShowModal('editTask'); } });
    });
    (state.meetings || []).forEach(m => push(m.date, { key: `m${m.id}`, kind: 'meeting', title: m.subject, time: m.time, done: m.status === 'completed', color: '#8151eb', onClick: () => navigate('/meetings') }));
    googleEvents.forEach((e: any) => {
      const start: string = e.start?.dateTime || e.start?.date || '';
      push(start.slice(0, 10), { key: `g${e.id}`, kind: 'google', title: e.summary || 'Busy', time: e.start?.dateTime ? new Date(start).toTimeString().slice(0, 5) : undefined, color: '#0e7fa3', link: e.hangoutLink || e.htmlLink });
    });
    map.forEach(list => list.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00')));
    return map;
  }, [state.tasks, state.meetings, state.categories, googleEvents]);

  // Month grid (Monday first, 6 rows)
  const cells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(calYear, calMonth, 1 - offset + i);
      return { date: localDateStr(d), day: d.getDate(), inMonth: d.getMonth() === calMonth };
    });
  }, [calYear, calMonth]);

  // Week containing the selected day
  const week = useMemo(() => {
    const d = new Date(selected + 'T00:00');
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return localDateStr(x); });
  }, [selected]);

  const shift = (dir: number) => {
    if (view === 'week') {
      const d = new Date(selected + 'T00:00');
      d.setDate(d.getDate() + dir * 7);
      setSelected(localDateStr(d));
      updateState({ calYear: d.getFullYear(), calMonth: d.getMonth() });
    } else {
      const d = new Date(calYear, calMonth + dir, 1);
      updateState({ calYear: d.getFullYear(), calMonth: d.getMonth() });
    }
  };
  const goToday = () => { const n = new Date(); setSelected(todayStr); updateState({ calYear: n.getFullYear(), calMonth: n.getMonth() }); };
  const addOn = (date: string, what: 'addTask' | 'scheduleMeeting') => { updateState({ selectedDate: date }); setShowModal(what); };

  const title = view === 'month'
    ? new Date(calYear, calMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : `${new Date(week[0] + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(week[6] + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const agenda = byDay.get(selected) || [];
  const kindIcon = { task: 'task_alt', meeting: 'groups', google: 'event' } as const;

  const pill = (it: Item) => (
    <button
      key={it.key}
      onClick={e => { e.stopPropagation(); it.onClick ? it.onClick() : it.link && window.open(it.link, '_blank', 'noopener'); }}
      className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-left truncate cursor-pointer hover:brightness-95 ${it.done ? 'opacity-50 line-through' : ''}`}
      style={{ background: `${it.color}1f`, color: it.color }}
      title={it.title}
    >
      {it.kind !== 'task' && <span className="font-semibold shrink-0">{it.time}</span>}
      <span className="truncate text-on-surface">{it.title}</span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={accessToken ? (loadingEvents ? 'Syncing Google Calendar…' : 'Tasks, meetings and Google Calendar in one place.') : 'Tasks and meetings by day.'}
        actions={
          <>
            <Segmented label="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
            <button className={btn.primary} onClick={() => addOn(selected, 'addTask')}><Icon name="add" className="text-[18px]" />Task on {relDay(selected)}</button>
          </>
        }
      />

      {!accessToken && !isOffline && (
        <div className={`${card} p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3`}>
          <Icon name="event" className="text-[24px] text-secondary" />
          <div className="flex-1">
            <div className="font-medium text-on-surface">Connect Google Calendar</div>
            <div className="text-[12px] text-on-surface-variant">See your events here and let Dante plan around them.</div>
          </div>
          <button className={btn.secondary} onClick={() => loginWithGoogle().catch(e => alert(e.message))}>Connect</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <section className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[18px] font-semibold text-on-surface">{title}</h2>
            <div className="flex items-center gap-1">
              <button className={btn.ghost} onClick={goToday}>Today</button>
              <button className={btn.icon} onClick={() => shift(-1)} aria-label="Previous"><Icon name="chevron_left" className="text-[20px]" /></button>
              <button className={btn.icon} onClick={() => shift(1)} aria-label="Next"><Icon name="chevron_right" className="text-[20px]" /></button>
            </div>
          </div>

          {view === 'month' ? (
            <motion.div key={`${calYear}-${calMonth}`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map(d => <div key={d} className="text-[12px] font-semibold text-on-surface-variant text-center py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1" role="grid">
                {cells.map(c => {
                  const items = byDay.get(c.date) || [];
                  const isSel = c.date === selected;
                  const isToday = c.date === todayStr;
                  return (
                    <div
                      key={c.date}
                      role="gridcell"
                      aria-selected={isSel}
                      tabIndex={0}
                      onClick={() => setSelected(c.date)}
                      onDoubleClick={() => addOn(c.date, 'addTask')}
                      onKeyDown={e => e.key === 'Enter' && setSelected(c.date)}
                      className={`min-h-[64px] md:min-h-[96px] p-1.5 rounded-lg cursor-pointer transition-colors flex flex-col gap-1 ${isSel ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-surface-container-low'} ${c.inMonth ? '' : 'opacity-40'}`}
                    >
                      <span className={`self-start text-[12px] w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-on-primary font-semibold' : 'text-on-surface'}`}>{c.day}</span>
                      <div className="hidden md:flex flex-col gap-0.5">
                        {items.slice(0, 3).map(pill)}
                        {items.length > 3 && <span className="text-[11px] text-on-surface-variant px-1">+{items.length - 3} more</span>}
                      </div>
                      {items.length > 0 && (
                        <div className="md:hidden flex gap-0.5 flex-wrap">{items.slice(0, 4).map(it => <span key={it.key} className="w-1.5 h-1.5 rounded-full" style={{ background: it.color }} />)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {week.map((d, i) => {
                const items = byDay.get(d) || [];
                return (
                  <div key={d} onClick={() => setSelected(d)} className={`rounded-xl p-2 min-h-[120px] md:min-h-[360px] cursor-pointer transition-colors ${d === selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'bg-surface-container-low/60 hover:bg-surface-container-low'}`}>
                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className="text-[12px] text-on-surface-variant font-semibold">{WEEKDAYS[i]}</span>
                      <span className={`text-[14px] font-semibold ${d === todayStr ? 'text-primary' : 'text-on-surface'}`}>{new Date(d + 'T00:00').getDate()}</span>
                    </div>
                    <div className="flex flex-col gap-1">{items.map(pill)}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-4 mt-4 text-[12px] text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" />Tasks (by category)</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#8151eb' }} />Meetings</span>
            {accessToken && <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#0e7fa3' }} />Google Calendar</span>}
            <span className="hidden md:inline">Double-click a day to add a task.</span>
          </div>
        </section>

        {/* Agenda for the selected day */}
        <aside className={`${card} p-4 xl:sticky xl:top-20`} aria-label="Agenda">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[12px] text-on-surface-variant">{new Date(selected + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' })}</div>
              <h2 className="text-[18px] font-semibold text-on-surface">{new Date(selected + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</h2>
            </div>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{agenda.length} item{agenda.length === 1 ? '' : 's'}</span>
          </div>

          {agenda.length === 0 ? (
            <p className="text-[13px] text-on-surface-variant py-6 text-center">Nothing planned.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agenda.map(it => (
                <li key={it.key} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-surface-container-low transition-colors">
                  <span className="w-1 self-stretch rounded-full" style={{ background: it.color }} />
                  <div className="flex-1 min-w-0">
                    <button onClick={() => (it.onClick ? it.onClick() : it.link && window.open(it.link, '_blank', 'noopener'))} className={`font-medium text-left cursor-pointer hover:text-primary ${it.done ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                      {it.title}
                    </button>
                    <div className="flex items-center gap-1 text-[12px] text-on-surface-variant">
                      <Icon name={kindIcon[it.kind]} className="text-[14px]" />
                      {it.kind === 'task' ? 'Task' : it.kind === 'meeting' ? 'Meeting' : 'Google Calendar'}{it.time && ` · ${it.time}`}
                    </div>
                  </div>
                  {it.kind === 'task' && (
                    <button
                      className={btn.icon}
                      aria-label={it.done ? 'Reopen task' : 'Complete task'}
                      onClick={() => it.taskId != null && toggleTaskDone(it.taskId)}
                    >
                      <Icon name={it.done ? 'undo' : 'check'} className="text-[18px]" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2 mt-4">
            <button className={btn.secondary} onClick={() => addOn(selected, 'addTask')}><Icon name="add_task" className="text-[18px]" />Task</button>
            <button className={btn.secondary} onClick={() => (accessToken ? addOn(selected, 'scheduleMeeting') : navigate('/meetings'))}><Icon name="groups" className="text-[18px]" />Meeting</button>
          </div>
          <button
            className={`${btn.ghost} w-full mt-2 text-primary`}
            onClick={() => navigate('/dante', { state: { prompt: `Plan ${relDay(selected).toLowerCase() === 'today' ? 'my day today' : `my day on ${selected}`}: look at my tasks and meetings and suggest a schedule.` } })}
          >
            <Icon name="auto_awesome" className="text-[18px]" />Plan this day with Dante
          </button>
        </aside>
      </div>
    </div>
  );
}
