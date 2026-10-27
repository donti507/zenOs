import { applyPostponement } from './postponement';
import type { Task } from '../types';
import { calendarDate, localDateStr, today } from './utils';

export const RECURRENCES = ['none', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type Recurrence = typeof RECURRENCES[number];
export const isRecurrence = (value: unknown): value is Recurrence => typeof value === 'string' && (RECURRENCES as readonly string[]).includes(value);
export { calendarDate } from './utils';
export function nextOccurrence(task: Task, id: string, fallback = today()): Task | null {
  const rule = task.recurrence || 'none';
  if (!isRecurrence(rule) || rule === 'none') return null;
  const base = calendarDate(task.date) || calendarDate(fallback)!;
  const next = new Date(base);
  const anchor = task.recurrenceDay || base.getDate();
  if (rule === 'monthly') {
    next.setDate(1); next.setMonth(next.getMonth() + 1);
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(anchor, last));
  } else {
    next.setDate(next.getDate() + (rule === 'weekly' ? 7 : 1));
    while (rule === 'weekdays' && (next.getDay() === 0 || next.getDay() === 6)) next.setDate(next.getDate() + 1);
  }
  let reminder = '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(task.reminder)) {
    const old = new Date(task.reminder);
    if (calendarDate(task.reminder.slice(0, 10)) && Number(task.reminder.slice(11, 13)) < 24 && Number(task.reminder.slice(14, 16)) < 60 && Number.isFinite(old.getTime())) {
      const days = Math.round((Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()) - Date.UTC(base.getFullYear(), base.getMonth(), base.getDate())) / 86400000);
      old.setDate(old.getDate() + days);
      reminder = `${localDateStr(old)}T${String(old.getHours()).padStart(2, '0')}:${String(old.getMinutes()).padStart(2, '0')}`;
    }
  }
  return { ...task, examPlan: undefined, id, postponedCount: 0, date: localDateStr(next), recurrence: rule, recurrenceDay: anchor, recurrenceSourceId: String(task.id), status: 'todo', progress: 0, completedAt: null, reminder, steps: (task.steps || []).map(step => ({ ...step, done: false })) };
}

/** Local-mode equivalent of the database completion trigger. */
export function updateTaskOccurrence(tasks: Task[], id: Task['id'], updates: Partial<Task>, nextId: () => string): Task[] {
  const previous = tasks.find(task => task.id === id);
  if (!previous) return tasks;
  const updated = applyPostponement(previous, updates);
  const result = tasks.map(task => task.id === id ? updated : task);
  if (previous.status !== 'done' && updated.status === 'done' && !tasks.some(task => task.recurrenceSourceId === String(id))) {
    const next = nextOccurrence(updated, nextId());
    if (next) result.push(next);
  }
  return result;
}
