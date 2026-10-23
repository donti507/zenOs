import { useMemo, useState, DragEvent } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useZenos } from '../context/ZenosContext';
import { Task } from '../types';
import { relDay, today, categoryTone } from '../lib/utils';
import { PageHeader, Icon, CategoryChip, btn, card } from '../components/ui/kit';

const COLUMNS: { key: Task['status']; label: string; icon: string; tone: string }[] = [
  { key: 'todo', label: 'To do', icon: 'radio_button_unchecked', tone: 'text-on-surface-variant' },
  { key: 'inprogress', label: 'In progress', icon: 'pending', tone: 'text-primary' },
  { key: 'done', label: 'Done', icon: 'check_circle', tone: 'text-success' },
];

export default function Board() {
  const { state, updateState, addTask, editTask, toggleTaskDone, setShowModal, setEditTaskId } = useZenos();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const todayStr = today();

  const tasks = useMemo(
    () =>
      state.tasks.filter(
        t => (!state.filterCat || t.cat === state.filterCat) && (!query || t.title.toLowerCase().includes(query.toLowerCase()))
      ),
    [state.tasks, state.filterCat, query]
  );

  const moveTo = async (id: string, status: Task['status']) => {
    const t = state.tasks.find(x => String(x.id) === id);
    if (!t || t.status === status) return;
    if (status === 'done' || t.status === 'done') {
      // toggleTaskDone keeps streak/completion history correct
      await toggleTaskDone(t.id);
      if (status === 'todo') await editTask(t.id, { status: 'todo' });
    } else {
      await editTask(t.id, { status, progress: status === 'inprogress' && t.progress === 0 ? 10 : t.progress });
    }
  };

  const onDrop = (e: DragEvent, status: Task['status']) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setOverCol(null);
    setDragId(null);
    if (id) moveTo(id, status);
  };

  const submitQuick = async (status: Task['status']) => {
    const title = (quickAdd[status] || '').trim();
    if (!title) return setAdding(null);
    await addTask({ title, cat: state.filterCat || state.categories[0]?.id || 'other', status, date: '', reminder: '', note: '', progress: status === 'done' ? 100 : 0, steps: [] });
    setQuickAdd(q => ({ ...q, [status]: '' }));
  };

  const openEdit = (t: Task) => { setEditTaskId(t.id); setShowModal('editTask'); };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Board"
        subtitle="Drag cards between columns to update their status."
        actions={
          <>
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter tasks" aria-label="Filter tasks"
                className="h-9 pl-9 pr-3 w-48 rounded-lg bg-surface-container-lowest shadow-soft outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button className={btn.primary} onClick={() => setShowModal('addTask')}><Icon name="add" className="text-[18px]" />New task</button>
          </>
        }
      />

      {/* Category filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-5" role="toolbar" aria-label="Filter by category">
        <button onClick={() => updateState({ filterCat: null })}
          className={`px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-colors ${!state.filterCat ? 'bg-on-surface text-surface' : 'bg-surface-container-lowest shadow-soft text-on-surface-variant hover:text-on-surface'}`}>
          All
        </button>
        {state.categories.map(c => (
          <button key={c.id} onClick={() => updateState({ filterCat: state.filterCat === c.id ? null : c.id })} aria-pressed={state.filterCat === c.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-colors ${state.filterCat === c.id ? 'bg-on-surface text-surface' : 'bg-surface-container-lowest shadow-soft text-on-surface-variant hover:text-on-surface'}`}>
            <span className={`w-2 h-2 rounded-full ${categoryTone(c).dot}`} />{c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {COLUMNS.map(col => {
          const colTasks = tasks
            .filter(t => t.status === col.key)
            .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
          const isOver = overCol === col.key;
          return (
            <section
              key={col.key}
              aria-label={col.label}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== col.key) setOverCol(col.key); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null); }}
              onDrop={e => onDrop(e, col.key)}
              className={`rounded-2xl p-3 min-h-[320px] transition-colors ${isOver ? 'bg-primary/10 ring-2 ring-primary/30 ring-dashed' : 'bg-surface-container-low/70'}`}
            >
              <header className="flex items-center justify-between px-1 pb-3">
                <div className="flex items-center gap-2">
                  <Icon name={col.icon} className={`text-[18px] ${col.tone}`} />
                  <h2 className="font-semibold text-on-surface">{col.label}</h2>
                  <span className="text-[12px] px-2 py-0.5 rounded-full bg-surface-container-lowest text-on-surface-variant font-medium">{colTasks.length}</span>
                </div>
                <button className={btn.icon} onClick={() => setAdding(col.key)} aria-label={`Add task to ${col.label}`}><Icon name="add" className="text-[18px]" /></button>
              </header>

              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {colTasks.map(t => {
                    const cat = state.categories.find(c => c.id === t.cat);
                    const overdue = t.status !== 'done' && t.date && t.date < todayStr;
                    const steps = t.steps || [];
                    return (
                      <motion.article
                        key={String(t.id)}
                        layout={!reduce}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: dragId === String(t.id) ? 0.4 : 1, y: 0, rotate: 0 }}
                        exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.18 }}
                        draggable
                        onDragStart={(e: any) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(String(t.id)); }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); }}
                        className={`group ${card} p-3.5 cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 transition-[box-shadow,transform]`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => toggleTaskDone(t.id)}
                            aria-label={t.status === 'done' ? `Reopen “${t.title}”` : `Complete “${t.title}”`}
                            className={`mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-colors ${t.status === 'done' ? 'bg-success text-white' : 'bg-surface-container-high text-transparent hover:text-primary'}`}
                          >
                            <Icon name="check" className="text-[15px]" />
                          </button>
                          <button onClick={() => openEdit(t)} className={`flex-1 text-left font-medium cursor-pointer hover:text-primary transition-colors ${t.status === 'done' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                            {t.title}
                          </button>
                          {/* Keyboard / touch friendly alternative to dragging */}
                          <select
                            value={t.status}
                            onChange={e => moveTo(String(t.id), e.target.value as Task['status'])}
                            aria-label={`Move “${t.title}”`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[12px] bg-surface-container-low rounded-md px-1 py-0.5 cursor-pointer outline-none"
                          >
                            {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </div>
                        {t.note && <p className="text-[12px] text-on-surface-variant mt-1.5 ml-7 line-clamp-2">{t.note}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 ml-7">
                          <CategoryChip cat={cat} />
                          {t.date && (
                            <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-error-container text-error' : t.date === todayStr ? 'bg-warning-container text-warning' : 'bg-surface-container text-on-surface-variant'}`}>
                              <Icon name="event" className="text-[13px]" />{relDay(t.date)}
                            </span>
                          )}
                          {steps.length > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-on-surface-variant"><Icon name="checklist" className="text-[13px]" />{steps.filter(s => s.done).length}/{steps.length}</span>
                          )}
                        </div>
                        {t.progress > 0 && t.status !== 'done' && (
                          <div className="mt-2.5 ml-7 h-1 rounded-full bg-surface-container-high overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${t.progress}%` }} /></div>
                        )}
                      </motion.article>
                    );
                  })}
                </AnimatePresence>

                {colTasks.length === 0 && adding !== col.key && (
                  <div className="text-center text-[12px] text-on-surface-variant py-8 border-2 border-dashed border-outline-variant rounded-xl">
                    {isOver ? 'Drop here' : 'No tasks'}
                  </div>
                )}

                {adding === col.key ? (
                  <div className={`${card} p-2`}>
                    <input
                      autoFocus
                      value={quickAdd[col.key] || ''}
                      onChange={e => setQuickAdd(q => ({ ...q, [col.key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') submitQuick(col.key); if (e.key === 'Escape') setAdding(null); }}
                      onBlur={() => submitQuick(col.key)}
                      placeholder="Task title, then Enter"
                      className="w-full px-2 py-1.5 bg-transparent outline-none"
                      aria-label={`New task in ${col.label}`}
                    />
                  </div>
                ) : (
                  <button onClick={() => setAdding(col.key)} className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface text-[13px] cursor-pointer transition-colors">
                    <Icon name="add" className="text-[18px]" />Add task
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
