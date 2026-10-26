import { useCallback, useEffect, useState } from 'react';
import type { Task } from '../types';
export type FocusSession = { userId: string; taskId: Task['id']; title: string; endsAt: number };
export function useFocusTimer(userId: string | null) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const focusSession = session?.userId === userId ? session : null;
  useEffect(() => { setSession(null); }, [userId]);
  const startFocus = useCallback((task: Task) => {
    if (!userId || task.status === 'done') return;
    const started = Date.now();
    setSession({ userId, taskId: task.id, title: task.title, endsAt: started + 300000 });
  }, [userId]);
  const stopFocus = useCallback(() => setSession(null), []);
  return { focusSession, startFocus, stopFocus };
}
export function focusSecondsLeft(endsAt: number, now = Date.now()) {
  return Math.min(300, Math.max(0, Math.ceil((endsAt - now) / 1000)));
}
