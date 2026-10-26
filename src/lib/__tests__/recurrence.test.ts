import { expect, it } from 'vitest';
import type { Task } from '../../types';
import { nextOccurrence, updateTaskOccurrence } from '../recurrence';
const task = (over: Partial<Task> = {}): Task => ({ id: 'a', title: 'Routine', cat: 'work', status: 'done', date: '2026-10-26', reminder: '', note: 'Keep notes', progress: 100, steps: [{ label: 'First', done: true }], ...over });
it.each([
  ['daily', '2026-12-31', '2027-01-01'], ['weekdays', '2026-10-30', '2026-11-02'],
  ['weekdays', '2026-10-31', '2026-11-02'], ['weekly', '2026-12-28', '2027-01-04'],
  ['monthly', '2027-01-31', '2027-02-28'], ['monthly', '2028-01-31', '2028-02-29'],
] as const)('advances %s from %s to %s', (recurrence, date, expected) => {
  expect(nextOccurrence(task({ recurrence, date }), 'next')?.date).toBe(expected);
});
it('keeps the original monthly day after a short month and resets completion/checklist state', () => {
  const feb = nextOccurrence(task({ recurrence: 'monthly', date: '2027-01-31' }), 'feb')!;
  const march = nextOccurrence(feb, 'march')!;
  expect(march.date).toBe('2027-03-31');
  expect(march).toMatchObject({ title: 'Routine', note: 'Keep notes', status: 'todo', progress: 0, completedAt: null, recurrenceSourceId: 'feb', steps: [{ label: 'First', done: false }] });
});
it('shifts reminder wall time by the same calendar offset as the due date', () => {
  const next = nextOccurrence(task({ recurrence: 'weekdays', date: '2026-10-30', reminder: '2026-10-29T09:30' }), 'next');
  expect(next?.reminder).toBe('2026-11-01T09:30');
});
it('does not repeat none/legacy tasks or duplicate successors on a repeated completion', () => {
  expect(nextOccurrence(task(), 'next')).toBeNull();
  let tasks = [task({ status: 'todo', recurrence: 'daily' })];
  tasks = updateTaskOccurrence(tasks, 'a', { status: 'done' }, () => 'next');
  tasks = updateTaskOccurrence(tasks, 'a', { status: 'done' }, () => 'duplicate');
  tasks = updateTaskOccurrence(tasks, 'a', { status: 'todo' }, () => 'unused');
  tasks = updateTaskOccurrence(tasks, 'a', { status: 'done' }, () => 'duplicate');
  expect(tasks).toHaveLength(2); expect(tasks[1].id).toBe('next');
});
it('clears an invalid reminder instead of shifting it to an invented date',()=>{
  expect(nextOccurrence(task({recurrence:'daily',reminder:'2026-02-31T09:00'}),'next')?.reminder).toBe('');
});
it('preserves local reminder time across daylight-saving changes',()=>{
  const prior=process.env.TZ;process.env.TZ='Europe/Warsaw';
  try{
    const next=nextOccurrence(task({recurrence:'daily',date:'2026-03-28',reminder:'2026-03-28T09:00'}),'next');
    expect(next?.date).toBe('2026-03-29');expect(next?.reminder).toBe('2026-03-29T09:00');
  }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
