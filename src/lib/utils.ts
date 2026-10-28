import {uiLocale,tr} from '../i18n';
export function fmtDate(s: string) {
  if (!s) return '';
  return new Date(s + 'T00:00').toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' });
}

export function fmtDateTime(s: string) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** YYYY-MM-DD in the user's local timezone (toISOString() would give the UTC date). */
export function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today() {
  return localDateStr();
}

/** Consecutive days (ending today, or yesterday if nothing is done yet today) with at least one completion. */
export function computeStreak(completionLog: string[]) {
  const days = new Set(completionLog);
  const cursor = new Date();
  if (!days.has(localDateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDateStr(cursor)) && streak < 3650) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function fmtBytes(b: number) {
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
  return (b / 1048576).toFixed(1) + 'MB';
}

export function getCatColor(id: string, theme: 'light' | 'dark' = 'light') {
  if (theme === 'light') {
    const map: Record<string, string> = {
      radio: '#5b2cab', // Deep Purple
      research: '#0369a1', // Deep Sky Blue
      application: '#c2410c', // Deep Orange / Copper
      other: '#475569', // Slate Gray
    };
    return map[id] || '#4143d5';
  } else {
    const map: Record<string, string> = {
      radio: '#d5c3ff', // Pastel Purple
      research: '#a5e7ff', // Pastel Blue
      application: '#ff9800', // Neon Orange
      other: '#8aa399', // Muted Teal/Gray
    };
    return map[id] || '#a3a5ff';
  }
}


export type CategoryTone = { dot: string; chip: string; hex: string };

/**
 * Colour for a category. Matches on the id *or* the label, so categories created in
 * Supabase (which have UUID ids) still get the right colour.
 */
export function categoryTone(cat?: { id?: string; label?: string; color?: string } | null): CategoryTone {
  const key = `${cat?.id || ''} ${cat?.label || ''}`.toLowerCase();
  if (key.includes('research')) return { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', hex: '#3b82f6' };
  if (key.includes('radio')) return { dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300', hex: '#a855f7' };
  if (key.includes('applic')) return { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300', hex: '#f97316' };
  if (key.includes('other')) return { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300', hex: '#94a3b8' };
  return { dot: 'bg-primary', chip: 'bg-surface-container text-on-surface-variant', hex: cat?.color || '#5b5fef' };
}

/** YYYY-MM-DD for today ± n days (local time). */
export function addDaysStr(n: number, from: Date = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** "Today", "Tomorrow", "Yesterday" or "Mon, 28 Oct". */
export function relDay(date: string) {
  if (!date) return '';
  if (date === today()) return tr('Today');
  if (date === addDaysStr(1)) return tr('Tomorrow');
  if (date === addDaysStr(-1)) return tr('Yesterday');
  return new Date(date + 'T00:00').toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDuration(totalSecs: number) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDateStr(date) === value ? date : null;
}
