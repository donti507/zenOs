import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { notificationStatus, notificationWasAsked, rememberNotificationChoice, reminderTime, requestTaskNotifications, showTaskReminder } from '../lib/taskNotifications';

export function useTaskNotifications(tasks: Task[], userId: string | null) {
  const [permission, setPermission] = useState(notificationStatus);
  const [asked, setAsked] = useState(notificationWasAsked);
  const session = useRef({ userId, started: Date.now(), sent: new Set<string>() });
  if (session.current.userId !== userId) session.current = { userId, started: Date.now(), sent: new Set() };
  const enable = useCallback(async () => {
    const result = await requestTaskNotifications();
    setPermission(notificationStatus() === 'unsupported' ? 'unsupported' : result);
    setAsked(notificationWasAsked());
  }, []);
  const dismiss = useCallback(() => { rememberNotificationChoice(); setAsked(true); }, []);
  useEffect(() => {
    const refresh = () => { setPermission(notificationStatus()); setAsked(notificationWasAsked()); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    if (!userId || permission !== 'granted') return;
    let timer: ReturnType<typeof setTimeout>;
    const current = session.current;
    const check = () => {
      if (session.current !== current) return;
      const now = Date.now();
      let wait = 30000; // catches clock changes and wakeups from background throttling
      for (const task of tasks) {
        const time = reminderTime(task);
        if (time === null || time < current.started) continue;
        const key = `${task.id}:${task.reminder}`;
        if (time <= now && !current.sent.has(key)) {
          if (showTaskReminder(task, userId)) current.sent.add(key);
        } else if (time > now) wait = Math.min(wait, time - now);
      }
      timer = setTimeout(check, Math.max(50, wait));
    };
    check();
    const wake = () => { clearTimeout(timer); check(); };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { clearTimeout(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [tasks, userId, permission]);
  return { notificationPermission: permission, canAskNotifications: permission === 'default' && !asked, enableTaskNotifications: enable, dismissTaskNotifications: dismiss };
}
