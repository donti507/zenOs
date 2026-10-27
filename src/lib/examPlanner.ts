import type { Task } from '../types';
import { calendarDate, localDateStr } from './utils';
export interface ExamPlan { id: string; name: string; examDate: string; minutesPerDay: number; topicId: string }
export interface StudySession { topic: string; topicId: string; date: string; minutes: number }
export interface ExamDraft { id: string; name: string; examDate: string; minutesPerDay: number; topics: { id: string; title: string }[] }
export function planExam(draft: ExamDraft, startDate: string, meetingDates: string[]): StudySession[] {
  const start = calendarDate(startDate), end = calendarDate(draft.examDate);
  if (!start || !end || draft.examDate <= startDate) throw new Error('Choose an exam date after today.');
  if (!draft.name.trim() || draft.name.length > 160) throw new Error('Enter an exam name (up to 160 characters).');
  if (!Number.isInteger(draft.minutesPerDay) || draft.minutesPerDay < 1 || draft.minutesPerDay > 1440) throw new Error('Choose 1–1440 minutes per day.');
  if (!draft.topics.length || draft.topics.length > 100 || draft.topics.some(t => !t.title.trim() || t.title.length > 200) || new Set(draft.topics.map(t => t.id)).size !== draft.topics.length) throw new Error('Enter 1–100 topics, up to 200 characters each.');
  const counts = new Map<string, number>();
  meetingDates.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
  const days: string[] = [];
  const cursor = new Date(end); cursor.setDate(cursor.getDate() - 1);
  let scanned = 0;
  for (; cursor >= start; cursor.setDate(cursor.getDate() - 1)) {
    if (++scanned > 730) throw new Error('Choose an exam within two years.');
    const date = localDateStr(cursor);
    if ((counts.get(date) || 0) < 2) days.push(date);
  }
  days.reverse();
  const minutes = Math.min(25, draft.minutesPerDay), capacity = Math.floor(draft.minutesPerDay / minutes);
  if (days.length * capacity < draft.topics.length) throw new Error('Not enough free study time. Increase the daily minutes or move the exam date.');
  const usedDays = Math.min(days.length, draft.topics.length);
  return draft.topics.map((topic, i) => {
    const group = Math.floor(i * usedDays / draft.topics.length);
    const index = usedDays === 1 ? days.length - 1 : Math.round(group * (days.length - 1) / (usedDays - 1));
    return { topic: topic.title.trim(), topicId: topic.id, date: days[index], minutes };
  });
}
export function remainingExamTasks(tasks: Task[], planId: string) {
  return tasks.filter(t => t.examPlan?.id === planId && t.status !== 'done' && !t.steps?.find(s => s.id === t.examPlan?.topicId)?.done);
}
export function examSnapshot(tasks: Task[]) {
  return tasks.map(t => ({ id: String(t.id), date: t.date, status: t.status, steps: t.steps || [], exam_plan: t.examPlan })).sort((a,b) => a.id.localeCompare(b.id));
}
