import type { Task, Meeting } from '../types';
import { MAX_SNAP_BYTES, parseSnapItems, snapItemError, type SnapItem } from '../../shared/snap';
export type SnapRow = SnapItem & { selected: boolean; saved?: boolean; error?: string };
export async function extractSnap(image: Blob, token: string | null, signal: AbortSignal) {
  if (!image.size || image.size > MAX_SNAP_BYTES) throw new Error('Choose an image up to 5 MB.');
  const response = await fetch('/api/snap', { method: 'POST', headers: { 'Content-Type': image.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: image, signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not read that page. Please try again.');
  return parseSnapItems(body);
}
export async function createReviewedItems(rows: SnapRow[], deps: {
  addTask: (task: Omit<Task, 'id'>) => Promise<Task | null>;
  addMeeting: (meeting: Omit<Meeting, 'id' | 'createdAt'>) => Promise<Meeting | null>;
  category: string;
  canContinue: () => boolean;
  onResult: (index: number, error: string | null) => void;
}) {
  for (const [index, row] of rows.entries()) {
    if (!deps.canContinue()) break;
    if (!row.selected || row.saved) continue;
    const invalid = snapItemError(row);
    if (invalid) { deps.onResult(index, invalid); continue; }
    try {
      const title = row.title.trim();
      const result = row.type === 'meeting'
        ? await deps.addMeeting({ personName: 'Syllabus', date: row.date, time: '', subject: title, status: 'upcoming', notes: '', elapsedSeconds: 0 })
        : await deps.addTask({ title: row.type === 'exam' && !/^exam\s*:/i.test(title) ? `Exam: ${title}` : title, date: row.date, cat: deps.category, status: 'todo', reminder: '', note: '', progress: 0, steps: [], recurrence: 'none' });
      if (deps.canContinue()) deps.onResult(index, result ? null : 'Could not save. Check your workspace before retrying.');
    } catch { if (deps.canContinue()) deps.onResult(index, 'Could not save. Check your workspace before retrying.'); }
  }
}
