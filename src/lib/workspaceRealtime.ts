import type { Task, Meeting, Category, VaultItem, ZenosState } from '../types';
import { isRecurrence } from './recurrence';
import { localDateStr } from './utils';

// ---------- row mappers (DB snake_case -> app camelCase) ----------
export const mapTask = (t: any): Task => ({
  examPlan: t.exam_plan || undefined,
  id: t.id,
  title: t.title,
  cat: t.cat || 'other',
  status: (t.status || 'todo') as Task['status'],
  date: t.date || '',
  reminder: t.reminder || '',
  note: t.note || '',
  progress: t.progress || 0,
  steps: t.steps || [],
  completedAt: t.completed_at || t.completedAt || null,
  postponedCount: t.postponed_count || 0,
  recurrence: isRecurrence(t.recurrence) ? t.recurrence : 'none',
  recurrenceSourceId: t.recurrence_source_id || t.recurrenceSourceId || null,
  recurrenceDay: t.recurrence_day || t.recurrenceDay || null,
});

export const mapMeeting = (m: any): Meeting => ({
  id: m.id,
  personName: m.person_name ?? m.personName ?? '',
  date: m.date || '',
  time: m.time || '',
  subject: m.subject || '',
  status: (m.status || 'upcoming') as Meeting['status'],
  elapsedSeconds: m.elapsed_seconds ?? m.elapsedSeconds ?? 0,
  notes: m.notes || '',
  googleEventId: m.google_event_id ?? m.googleEventId ?? null,
  createdAt: m.created_at ?? m.createdAt ?? new Date().toISOString(),
});

export const completionLogFromTasks = (tasks: Task[]) =>
  tasks.filter(t => t.status === 'done' && t.completedAt).map(t => localDateStr(new Date(t.completedAt as string)));

export const mapCategory = (c: any): Category => ({ id: c.id, label: c.label, color: c.color || '#888' });
export const mapVaultItem = (v: any): VaultItem => ({ id: v.id, type: v.type || 'link', name: v.name, detail: v.detail || '', url: v.url || '', addedAt: v.added_at });
export const WORKSPACE_TABLES = ['tasks', 'categories', 'meetings', 'vault_items'] as const;
export type WorkspaceTable = typeof WORKSPACE_TABLES[number];
export type WorkspaceChange = { table: WorkspaceTable; operation: 'INSERT' | 'UPDATE' | 'DELETE'; row: Record<string, any> };
export const workspaceTopic = (userId: string) => `zenos:workspace:${userId}`;

/** Broadcast payloads contain full OLD rows for deletes, unlike filtered Postgres Changes. */
export function readWorkspaceChange(message: unknown, userId: string): WorkspaceChange | null {
  const payload = (message as any)?.payload;
  if (payload?.schema !== 'public' || !WORKSPACE_TABLES.includes(payload.table) || !['INSERT', 'UPDATE', 'DELETE'].includes(payload.operation)) return null;
  const row = payload.operation === 'DELETE' ? payload.old_record : payload.record;
  if (!row || row.workspace_id != null || row.user_id !== userId || !['string', 'number'].includes(typeof row.id) || String(row.id) === '') return null;
  return { table: payload.table, operation: payload.operation, row };
}

function upsert<T extends { id: string | number }>(items: T[], row: T, prepend = false): T[] {
  const index = items.findIndex(item => String(item.id) === String(row.id));
  if (index < 0) return prepend ? [row, ...items] : [...items, row];
  return items.filter((item, i) => String(item.id) !== String(row.id) || i === index).map(item => String(item.id) === String(row.id) ? row : item);
}
export function mergeWorkspaceChange(state: ZenosState, change: WorkspaceChange): ZenosState {
  const remove = <T extends { id: string | number }>(items: T[]) => items.filter(item => String(item.id) !== String(change.row.id));
  const merge = <T extends { id: string | number }>(items: T[], map: (row: any) => T, prepend = false) => change.operation === 'DELETE' ? remove(items) : upsert(items, map(change.row), prepend);
  switch (change.table) {
    case 'tasks': {
      const tasks = merge(state.tasks, mapTask);
      return { ...state, tasks, completionLog: completionLogFromTasks(tasks) };
    }
    case 'categories': return { ...state, categories: merge(state.categories, mapCategory) };
    case 'meetings': return { ...state, meetings: merge(state.meetings || [], mapMeeting, true) };
    case 'vault_items': return { ...state, vault: merge(state.vault, mapVaultItem, true) };
  }
}

/** A mutation response may arrive after its Realtime echo (or a newer remote update). */
export function insertWorkspaceRow(state: ZenosState, table: WorkspaceTable, row: Record<string, any>): ZenosState {
  const items = table === 'tasks' ? state.tasks : table === 'categories' ? state.categories : table === 'meetings' ? state.meetings || [] : state.vault;
  return items.some(item => String(item.id) === String(row.id)) ? state : mergeWorkspaceChange(state, { table, operation: 'INSERT', row });
}
