import { lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ZenosProvider, useZenos } from './context/ZenosContext';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Legal from './pages/Legal';
import DanteOrb from './components/DanteOrb';
import { today } from './lib/utils';

// Each page is its own chunk and only loads when opened
const Home = lazy(() => import('./pages/Home'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Kanban = lazy(() => import('./pages/Board'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Meetings = lazy(() => import('./pages/Meetings'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Vault = lazy(() => import('./pages/Vault'));
const DanteAI = lazy(() => import('./components/views/DanteAI'));

function AppRoutes() {
  const { user, isLoadingData, setShowBriefing, passwordRecovery, setPasswordRecovery } = useZenos();

  // Morning briefing once per day between 5:00 and 11:00
  useEffect(() => {
    if (!user || isLoadingData) return;
    const hours = new Date().getHours();
    try {
      const key = `zenos_briefing_seen_${today()}`;
      if (hours >= 5 && hours < 11 && !localStorage.getItem(key)) setShowBriefing(true);
    } catch { /* storage blocked */ }
  }, [user, isLoadingData, setShowBriefing]);

  // Public pages, visible without signing in
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (path === '/privacy' || path === '/terms') return <Legal page={path === '/privacy' ? 'privacy' : 'terms'} />;

  if (passwordRecovery) return <Login initialView="reset-password" onRecovered={() => setPasswordRecovery(false)} />;
  if (!user) return <Login />;

  if (isLoadingData) {
    return (
      <div className="min-h-dvh bg-surface flex flex-col items-center justify-center gap-4">
        <DanteOrb state="thinking" size={56} />
        <div className="text-on-surface-variant">Loading your workspace…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="board" element={<Kanban />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="vault" element={<Vault />} />
        <Route path="dante" element={<DanteAI />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ZenosProvider>
        <AppRoutes />
      </ZenosProvider>
    </BrowserRouter>
  );
}
