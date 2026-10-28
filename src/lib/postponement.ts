import {tr} from '../i18n';
import type { Task } from '../types';
import { calendarDate } from './utils';

export function postponedCount(task: Pick<Task, 'postponedCount'>) {
  return Number.isInteger(task.postponedCount) && task.postponedCount! >= 0 ? task.postponedCount! : 0;
}
/** Count real, valid calendar-date transitions; never accept a stale counter patch. */
export function applyPostponement(previous: Task, updates: Partial<Task>): Task {
  const later = typeof updates.date === 'string' && calendarDate(previous.date) && calendarDate(updates.date) && updates.date > previous.date;
  return { ...previous, ...updates, postponedCount: Math.min(2147483647, postponedCount(previous) + (later ? 1 : 0)) };
}
export function breakdownPrompt(task: Task) {
  return tr("Help me start this existing task: id {{0}}, title {{1}}. Create exactly 3 tiny, concrete subtasks as checklist steps, each small enough to start in about 5 minutes. Use add_task_steps on this task ID to append them; preserve existing steps, due date and other fields. Do not create separate tasks.",JSON.stringify(String(task.id)),JSON.stringify(task.title));
}
