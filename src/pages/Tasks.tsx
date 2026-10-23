import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useZenos } from '../context/ZenosContext';
import { Task } from '../types';
import { addDaysStr, relDay, today, categoryTone } from '../lib/utils';
import { PageHeader, Icon, CategoryChip, Segmented, EmptyState, btn, card } from '../components/ui/kit';

type Show = 'open' | 'done' | 'all';

export default function Tasks() {
  const { state, updateState, toggleTaskDone, setShowModal, setEditTaskId } = useZenos();
  const reduce = useReducedMotion();
  const [show, setShow] = useState<Show>('open');
  const [query, setQuery] = useState('');
  const todayStr = today();
  const weekEnd = addDaysStr(7);
  const activeCat = state.categories.find(c => c.id === state.filterCat);

  const groups = useMemo(() => {
    const list = state.tasks.filter(t =>
      (!state.filterCat || t.cat === state.filterCat) &&
      (show === 'all' || (show === 'done' ? t.status === 'done' : t.status !== 'done')) &&
      (!query || `${t.title} ${t.note}`.toLowerCase().includes(query.toLowerCase()))
    );
    if (show === 'done') {
      return [{ key: 'done', label: 'Completed', items: list.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')) }];
    }
    const byDate = (a: Task, b: Task) => (a.date || '').localeCompare(b.date || '');
    const g = [
      { key: 'overdue', label: 'Overdue', items: list.filter(t => t.status !== 'done' && t.date && t.date < todayStr).sort(byDate) },
      { key: 'today', label: 'Today', items: list.filter(t => t.date === todayStr) },
      { key: 'week', label: 'Next 7 days', items: list.filter(t => t.date > todayStr && t.date <= weekEnd).sort(byDate) },
      { key: 'later', label: 'Later', items: list.filter(t => t.date > weekEnd).sort(byDate) },
      { key: 'nodate', label: 'No date', items: list.filter(t => !t.date) },
    ];
    if (show === 'all') g[0].items = list.filter(t => t.status !== 'done' && t.date && t.date < todayStr).sort(byDate);
    return g.filter(x => x.items.length);
  }, [state.tasks, state.filterCat, show, query, todayStr]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      <PageHeader
        title={activeCat ? activeCat.label : 'All tasks'}
        subtitle={`${total} ${show === 'done' ? 'completed' : show === 'open' ? 'open' : ''} task${total === 1 ? '' : 's'}`}
        actions={<button className={btn.primary} onClick={() => setShowModal('addTask')}><Icon name="add" className="text-[18px]" />New task</button>}
      />

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <Segmented<Show> label="Show" value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Completed' }, { value: 'all', label: 'All' }]} />
        <div className="relative flex-1 max-w-sm">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
            className="h-10 w-full pl-9 pr-3 rounded-lg bg-surface-container-lowest shadow-soft outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {state.categories.map(c => (
            <button key={c.id} onClick={() => updateState({ filterCat: state.filterCat === c.id ? null : c.id })} aria-pressed={state.filterCat === c.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer transition-colors ${state.filterCat === c.id ? 'bg-on-surface text-surface' : 'bg-surface-container-lowest shadow-soft text-on-surface-variant hover:text-on-surface'}`}>
              <span className={`w-2 h-2 rounded-full ${categoryTone(c).dot}`} />{c.label}
            </button>
          ))}
          {state.filterCat && <button className="text-[12px] text-primary px-2 cursor-pointer" onClick={() => updateState({ filterCat: null })}>Clear</button>}
        </div>
      </div>

      {groups.length === 0 && (
        <div className={card}>
          <EmptyState icon={show === 'done' ? 'history' : 'task_alt'} title={query ? 'No matching tasks' : show === 'done' ? 'Nothing completed yet' : 'No open tasks'}
            text={query ? 'Try a different search.' : 'Add a task, or ask Dante to create some for you.'}
            action={<button className={btn.primary} onClick={() => setShowModal('addTask')}>New task</button>} />
        </div>
      )}

      <div className="flex flex-col gap-6">
        {groups.map(g => (
          <section key={g.key} aria-label={g.label}>
            <h2 className={`flex items-center gap-2 text-[13px] font-semibold mb-2 ${g.key === 'overdue' ? 'text-error' : 'text-on-surface-variant'}`}>
              {g.label}<span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{g.items.length}</span>
            </h2>
            <div className={`${card} divide-y divide-outline-variant overflow-hidden`}>
              <AnimatePresence initial={false}>
                {g.items.map(t => {
                  const cat = state.categories.find(c => c.id === t.cat);
                  const done = t.status === 'done';
                  return (
                    <motion.div key={String(t.id)} layout={!reduce} exit={reduce ? undefined : { opacity: 0, height: 0 }}
                      className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/60 transition-colors">
                      <button onClick={() => toggleTaskDone(t.id)} aria-label={done ? `Reopen “${t.title}”` : `Complete “${t.title}”`}
                        className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors ${done ? 'bg-success border-success text-white' : 'border-outline hover:border-primary text-transparent hover:text-primary'}`}>
                        <Icon name="check" className="text-[14px]" />
                      </button>
                      <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => { setEditTaskId(t.id); setShowModal('editTask'); }}>
                        <div className={`font-medium truncate ${done ? 'line-through text-on-surface-variant' : 'text-on-surface group-hover:text-primary'}`}>{t.title}</div>
                        {t.note && <div className="text-[12px] text-on-surface-variant truncate">{t.note}</div>}
                      </button>
                      <div className="hidden sm:flex items-center gap-2 shrink-0">
                        {t.status === 'inprogress' && <span className="text-[11px] text-primary font-medium">In progress</span>}
                        <CategoryChip cat={cat} />
                        {t.date && <span className={`text-[12px] w-24 text-right ${!done && t.date < todayStr ? 'text-error font-medium' : 'text-on-surface-variant'}`}>{relDay(t.date)}</span>}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
