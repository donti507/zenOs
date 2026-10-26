import { calendarDate } from './recurrence';
import type { Task } from '../types';

const ASKED = 'zenos_notification_permission_asked';
const SENT = 'zenos_reminder_receipts';
let askedInMemory = false;
let pending: Promise<NotificationPermission> | null = null;
export function notificationStatus(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
export function notificationWasAsked() {
  try { return askedInMemory || localStorage.getItem(ASKED) === '1'; } catch { return askedInMemory; }
}
export function rememberNotificationChoice() {
  askedInMemory = true;
  try { localStorage.setItem(ASKED, '1'); } catch { /* remember for this session */ }
}
/** Must be invoked from a click/save gesture; never ask on mount or in a timer. */
export function requestTaskNotifications(): Promise<NotificationPermission> {
  if (pending) return pending;
  const permission = notificationStatus();
  if (permission === 'unsupported') return Promise.resolve('denied');
  if (permission !== 'default' || notificationWasAsked()) return Promise.resolve(permission);
  rememberNotificationChoice();
  try {
    pending = Notification.requestPermission().catch(() => Notification.permission).finally(() => { pending = null; });
    return pending;
  } catch { return Promise.resolve(Notification.permission); }
}
export function reminderTime(task: Task) {
  if (task.status === 'done' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(task.reminder)) return null;
  if (!calendarDate(task.reminder.slice(0, 10)) || Number(task.reminder.slice(11, 13)) > 23 || Number(task.reminder.slice(14, 16)) > 59) return null;
  const time = new Date(task.reminder).getTime();
  return Number.isFinite(time) ? time : null;
}
export function showTaskReminder(task: Task, userId: string): boolean {
  if (notificationStatus() !== 'granted') return false;
  const key = JSON.stringify([userId, String(task.id), task.reminder]);
  let receipts: Record<string, number> = {};
  try { const stored = JSON.parse(localStorage.getItem(SENT) || '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) receipts = stored; } catch { /* storage blocked/corrupt */ }
  if (receipts[key]) return false;
  try {
    const notification = new Notification('ZEN OS task reminder', { body: task.title, tag: key });
    notification.onclick = () => { window.focus(); notification.close(); };
    receipts[key] = Date.now();
    // Keep only recent receipt metadata. Never store task/note content here.
    const cutoff = Date.now() - 30 * 86400000;
    receipts = Object.fromEntries(Object.entries(receipts).filter(([, timestamp]) => timestamp >= cutoff));
    try { localStorage.setItem(SENT, JSON.stringify(receipts)); } catch { /* tag still coalesces notifications */ }
    return true;
  } catch { return false; /* e.g. browsers that require a service worker */ }
}
