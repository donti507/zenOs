import LocalImportDialog from '../LocalImportDialog';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import Sidebar from './Sidebar';
import Header from './Header';
import OnFirstOpen from '../OnFirstOpen';

import DanteOrb from '../DanteOrb';
import { useZenos } from '../../context/ZenosContext';
import { pathForView, routeForPath } from '../../lib/routes';

const Modals = lazy(() => import('../Modals'));
const MorningBriefing = lazy(() => import('../MorningBriefing'));
const DanteLive = lazy(() => import('../DanteLive'));

const MOBILE_TABS = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/board', icon: 'view_kanban', label: 'Board' },
  { to: '/calendar', icon: 'calendar_today', label: 'Calendar' },
  { to: '/meetings', icon: 'videocam', label: 'Meetings' },
  { to: '/vault', icon: 'folder_special', label: 'Vault' },
];

/**
 * Keeps the URL and the older `state.view` in sync, so existing code that calls
 * updateState({ view }) (Dante actions, briefing, modals) still navigates correctly.
 */
function RouteSync() {
  const { state, updateState } = useZenos();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // View the URL asked for that state hasn't caught up with yet
  const pending = useRef<string | null>(null);

  // URL changed (link, back button, deep link) → update state.view
  useEffect(() => {
    const view = routeForPath(pathname).view;
    if (view === state.view) {
      pending.current = null;
    } else {
      pending.current = view;
      updateState({ view });
    }
  }, [pathname]);

  // state.view changed by code (e.g. a Dante action) → navigate
  useEffect(() => {
    const urlView = routeForPath(pathname).view;
    if (state.view === urlView) {
      pending.current = null;
      return;
    }
    if (pending.current) return; // state is still catching up with the URL
    navigate(pathForView(state.view));
  }, [state.view]);

  return null;
}

export function PageLoader() {
  return (
    <div className="p-8 flex flex-col gap-4 max-w-5xl" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-28 w-full" />
      <div className="skeleton h-28 w-full" />
    </div>
  );
}

export default function AppShell() {
  const { pathname } = useLocation();
  const { setLiveOpen, localImportOpen, showModal, showBriefing, liveOpen } = useZenos();

  // Ctrl+Shift+Space opens Dante Live from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); setLiveOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('zenos_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('zenos_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  const isDante = pathname.startsWith('/dante');
  useEffect(() => {
    document.title = `${routeForPath(pathname).label} · ZEN OS`;
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-surface text-on-surface">
      <RouteSync />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] bg-primary text-on-primary px-3 py-2 rounded-lg">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <Header sidebarCollapsed={collapsed} />

      <main
        id="main"
        className={`pt-16 ${collapsed ? 'md:pl-[72px]' : 'md:pl-60'} transition-[padding] duration-200 ${isDante ? 'h-dvh overflow-hidden' : 'pb-20 md:pb-8'}`}
      >
        <motion.div
          key={pathname}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className={isDante ? 'h-full md:p-4' : ''}
        >
          <Suspense fallback={<PageLoader />}>
            <div className={isDante ? 'h-full' : pathname === '/' ? '' : 'px-4 md:px-8 py-6 max-w-[1440px] mx-auto'}>
              <Outlet />
            </div>
          </Suspense>
        </motion.div>
      </main>

      {/* Mobile: bottom tabs + floating Dante button */}
      {!isDante && (
        <NavLink to="/dante" aria-label="Ask Dante" className="md:hidden fixed right-4 bottom-[76px] z-40 rounded-full shadow-lg">
          <DanteOrb size={52} />
        </NavLink>
      )}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-surface-container-lowest/95 backdrop-blur-xl shadow-[0_-1px_8px_rgba(0,0,0,0.05)] flex items-center justify-around z-40 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {MOBILE_TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 flex-1 py-1 transition-colors ${isActive ? 'text-primary' : 'text-on-surface-variant'}`}
          >
            {({ isActive }) => (
              <>
                <span className={`material-symbols-outlined text-[22px] px-4 py-0.5 rounded-full ${isActive ? 'bg-primary/10' : ''}`} style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>{t.icon}</span>
                <span className="text-[11px] font-medium">{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <LocalImportDialog />
      <OnFirstOpen open={!!showModal}><Modals /></OnFirstOpen>
      {!localImportOpen && <OnFirstOpen open={showBriefing}><MorningBriefing /></OnFirstOpen>}
      <OnFirstOpen open={liveOpen}><DanteLive /></OnFirstOpen>
    </div>
  );
}
