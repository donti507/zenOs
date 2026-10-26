import { useEffect, useState } from 'react';
import { focusSecondsLeft } from '../hooks/useFocusTimer';
import { useZenos } from '../context/ZenosContext';
import { btn, card } from './ui/kit';
export default function FocusTimer() {
  const { focusSession, stopTaskFocus } = useZenos();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!focusSession) return;
    const tick = () => { const time = Date.now(); setNow(time); if (time >= focusSession.endsAt) clearInterval(timer); };
    const timer = setInterval(tick, 1000);
    tick();
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [focusSession]);
  if (!focusSession) return null;
  const remaining = focusSecondsLeft(focusSession.endsAt, now);
  const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  return <aside aria-label="Five-minute focus" className={`${card} fixed bottom-20 left-4 right-20 md:left-auto md:right-4 md:bottom-4 md:w-80 z-[60] p-4 border border-primary/30`}>
    <p className="text-sm font-medium text-on-surface truncate" title={focusSession.title}>{focusSession.title}</p>
    <div className="flex items-center justify-between gap-3 mt-2">
      <span role="timer" aria-live="off" aria-label="Focus time remaining" className="text-2xl font-semibold tabular-nums text-primary">{time}</span>
      <button className={`${btn.secondary} text-xs`} onClick={stopTaskFocus} aria-label={remaining ? 'Stop focus timer' : 'Close focus timer'}>{remaining ? 'Stop' : 'Close'}</button>
    </div>
    {remaining === 0 && <p role="status" className="text-sm text-on-surface-variant mt-2">Five minutes done. A small start counts.</p>}
  </aside>;
}
