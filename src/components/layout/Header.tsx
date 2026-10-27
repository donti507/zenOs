import AccountControls from '../AccountControls';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useZenos } from '../../context/ZenosContext';
import { createGoogleCalendarEvent } from '../../lib/googleCalendar';
import { localDateStr } from '../../lib/utils';
import { routeForPath } from '../../lib/routes';
import { useDanteStatus } from '../../hooks/useDanteStatus';

const SUBTITLES: Record<string, string> = {
  '/': "Today's focus",
  '/tasks': 'Every task',
  '/board': 'Kanban',
  '/calendar': 'Month view',
  '/meetings': 'Schedule & live notes',
  '/analytics': 'Your progress',
  '/vault': 'Links & files',
  '/dante': 'AI assistant',
};

export default function Header({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const { state, updateState, toggleTheme, setShowModal, setShowBriefing, googleConnected, getGoogleAccessToken, fetchGoogleEvents, user, setLiveOpen, logOut } = useZenos();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const status = useDanteStatus();
  const [accountOpen, setAccountOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creatingMeet, setCreatingMeet] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const route = routeForPath(pathname);
  const name: string = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'You';

  // ⌘K / Ctrl+K focuses "Search or ask Dante"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = () => {
    const q = query.trim();
    if (!q) return navigate('/dante');
    setQuery('');
    inputRef.current?.blur();
    navigate('/dante', { state: { prompt: q } });
  };

  const instantMeet = async () => {
    if (!googleConnected || creatingMeet) return;
    setCreatingMeet(true);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 60 * 60 * 1000);
      const created = await createGoogleCalendarEvent(getGoogleAccessToken, {
        summary: 'Instant meeting (ZEN OS)',
        description: 'Instant meeting room created from ZEN OS.',
        date: localDateStr(now),
        startTime: now.toTimeString().slice(0, 5),
        endTime: end.toTimeString().slice(0, 5),
        addMeetLink: true,
      });
      await fetchGoogleEvents();
      updateState({ instantMeetEvent: created });
      setShowModal('instantMeetSuccess');
    } catch (err: any) {
      alert(err?.message || 'Could not create the meeting.');
    } finally {
      setCreatingMeet(false);
    }
  };

  return (
    <header
      className={`fixed top-0 right-0 left-0 ${sidebarCollapsed ? 'md:left-[72px]' : 'md:left-60'} h-16 bg-surface-container-lowest/80 backdrop-blur-xl z-40 flex items-center justify-between gap-3 px-4 md:px-6 shadow-soft transition-[left] duration-200`}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 min-w-0">
        <span className="md:hidden w-7 h-7 rounded-lg bg-[conic-gradient(from_200deg,#5b5fef,#8b5cf6,#06b6d4,#5b5fef)] mr-1 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline font-medium text-on-surface-variant">{route.label}</span>
        <span className="hidden sm:inline-flex"><span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span></span>
        <span className="text-[16px] leading-6 font-semibold text-on-surface truncate">{SUBTITLES[route.path] || route.label}</span>
      </div>

      {/* Search / ask Dante */}
      {pathname !== '/dante' && (
        <div className="hidden lg:block flex-1 max-w-md mx-4">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-3 text-[18px] text-on-surface-variant">search</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
              className="w-full h-9 pl-9 pr-16 bg-surface-container-low rounded-lg text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container focus:ring-2 focus:ring-primary/20 transition-colors"
              placeholder="Ask Dante anything…"
              aria-label="Ask Dante"
              type="text"
            />
            <div className="absolute right-2 flex items-center gap-1.5">
              <button className="text-on-surface-variant hover:text-primary transition-colors flex items-center cursor-pointer" type="button" onClick={() => setLiveOpen(true)} aria-label="Talk to Dante (Live)">
                <span className="material-symbols-outlined text-[16px]">mic</span>
              </button>
              <kbd className="text-[11px] bg-surface-container px-1.5 py-0.5 rounded text-on-surface-variant font-medium">⌘K</kbd>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
        <button
          onClick={() => setLiveOpen(true)}
          className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-colors ${status && !status.ready ? 'bg-error-container text-error' : 'bg-gradient-to-r from-primary-container to-tertiary-container text-white hover:brightness-110 shadow-soft'}`}
          title={status?.problem || 'Talk to Dante hands-free (Ctrl+Shift+Space)'}
        >
          <span className="material-symbols-outlined text-[18px]">{status && !status.ready ? 'error' : 'graphic_eq'}</span>
          <span className="text-[13px] font-semibold">{status && !status.ready ? 'Dante offline' : 'Live'}</span>
        </button>

        {googleConnected && (
          <button onClick={instantMeet} disabled={creatingMeet} aria-label="Start an instant meeting" title="Instant meeting"
            className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer disabled:opacity-50">
            <span className="material-symbols-outlined text-[20px]">{creatingMeet ? 'progress_activity' : 'video_call'}</span>
          </button>
        )}

        <button onClick={toggleTheme} aria-label={state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[20px]">{state.theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>

        <button onClick={() => setShowBriefing(true)} aria-label="Open morning briefing" title="Morning briefing"
          className="relative w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
          {state.tasks.some(t => t.status !== 'done' && t.date && t.date < localDateStr()) && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
          )}
        </button>

        <button onClick={() => setShowModal('addTask')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary font-medium transition-colors shadow-soft cursor-pointer active:scale-[0.98]">
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span className="hidden sm:inline">New task</span>
        </button>

        <div className="relative md:hidden">
          <button className="w-8 h-8 rounded-full bg-primary text-on-primary font-semibold" aria-label="Account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(v => !v)}>{name.slice(0, 1).toUpperCase()}</button>
          {accountOpen && <div role="menu" className="absolute right-0 top-full mt-2 w-60 max-w-[90vw] bg-surface-container-lowest rounded-xl shadow-lg ring-1 ring-outline-variant py-1">
            <AccountControls />
            <button role="menuitem" className="w-full px-3 py-2 text-left text-on-surface hover:bg-surface-container" onClick={() => { setAccountOpen(false); logOut(); }}>Sign out</button>
          </div>}
        </div>

        <div className="hidden md:flex w-8 h-8 rounded-full bg-primary items-center justify-center ml-1" title={name}>
          <span className="text-on-primary text-[12px] font-semibold">{name.slice(0, 1).toUpperCase()}</span>
        </div>
      </div>
    </header>
  );
}
