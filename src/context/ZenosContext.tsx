import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { ZenosState, Task, Category, VaultItem, Meeting, DanteMessage } from '../types';
import { today, localDateStr } from '../lib/utils';
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase';
import { exportAccountData, deleteAccountData, downloadAccountData } from '../lib/accountData';
import { fetchGoogleCalendarEvents } from '../lib/googleCalendar';

export const OFFLINE_USER_ID = 'offline-user-123';

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'radio', label: 'Radio Work', color: '#d5c3ff' },
  { id: 'research', label: 'Research', color: '#a5e7ff' },
  { id: 'application', label: 'Application', color: '#ff9800' },
  { id: 'other', label: 'Other', color: '#888' },
];

const DEFAULT_STATE: ZenosState = {
  view: 'dashboard',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  theme: 'light',
  filterCat: null,
  tasks: [],
  categories: DEFAULT_CATEGORIES,
  specialTasks: [],
  vault: [],
  danteHistory: [],
  completionLog: [],
  selectedDate: null,
  meetings: [],
};

// localStorage keys used in offline / local-only mode
const LS = {
  tasks: 'zenos_tasks',
  categories: 'zenos_categories',
  vault: 'zenos_vault',
  meetings: 'zenos_meetings',
  dante: 'zenos_dante_history',
  completion: 'zenos_completion_log',
  theme: 'zenos_theme',
};

const DANTE_HISTORY_LIMIT = 40;

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeLS = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or blocked */ }
};

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ---------- row mappers (DB snake_case -> app camelCase) ----------
const mapTask = (t: any): Task => ({
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
});

const mapMeeting = (m: any): Meeting => ({
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

const meetingToRow = (m: Partial<Meeting>) => {
  const row: Record<string, any> = {};
  if (m.personName !== undefined) row.person_name = m.personName;
  if (m.date !== undefined) row.date = m.date;
  if (m.time !== undefined) row.time = m.time;
  if (m.subject !== undefined) row.subject = m.subject;
  if (m.status !== undefined) row.status = m.status;
  if (m.elapsedSeconds !== undefined) row.elapsed_seconds = m.elapsedSeconds;
  if (m.notes !== undefined) row.notes = m.notes;
  if (m.googleEventId !== undefined) row.google_event_id = m.googleEventId;
  return row;
};

/** Removes undefined keys so a partial update doesn't null out columns. */
const compact = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const completionLogFromTasks = (tasks: Task[]) =>
  tasks.filter(t => t.status === 'done' && t.completedAt).map(t => localDateStr(new Date(t.completedAt as string)));

export type NewMeeting = Omit<Meeting, 'id' | 'createdAt'>;

interface ZenosContextType {
  state: ZenosState;
  updateState: (updates: Partial<ZenosState>) => void;
  toggleTheme: () => void;
  toggleTaskDone: (id: number | string) => Promise<void>;
  deleteTask: (id: number | string) => Promise<void>;
  addTask: (task: Omit<Task, 'id'>) => Promise<Task | null>;
  editTask: (id: number | string, updates: Partial<Task>) => Promise<void>;
  addCategory: (label: string, color: string) => Promise<void>;
  addVaultItem: (item: Omit<VaultItem, 'id' | 'addedAt'>) => Promise<void>;
  deleteVaultItem: (id: string) => Promise<void>;
  addMeeting: (m: NewMeeting) => Promise<Meeting | null>;
  updateMeeting: (id: string, updates: Partial<Meeting>, opts?: { persist?: boolean }) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  showModal: string | null;
  setShowModal: (m: string | null) => void;
  editTaskId: number | string | null;
  setEditTaskId: (id: number | string | null) => void;
  user: any | null;
  isOffline: boolean;
  accessToken: string | null;
  googleEvents: any[];
  setGoogleEvents: React.Dispatch<React.SetStateAction<any[]>>;
  loadingEvents: boolean;
  isLoadingData: boolean;
  syncError: string | null;
  loginWithGoogle: (withCalendar?: boolean) => Promise<void>;
  logOut: () => Promise<void>;
  exportMyData: () => Promise<void>;
  deleteMyAccount: () => Promise<void>;
  fetchGoogleEvents: () => Promise<void>;
  loginOffline: (email?: string, name?: string) => void;
  showBriefing: boolean;
  setShowBriefing: (show: boolean) => void;
  saveDanteMessage: (role: 'user' | 'assistant', content: string) => Promise<DanteMessage>;
  clearDanteHistory: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  liveOpen: boolean;
  setLiveOpen: (open: boolean) => void;
  passwordRecovery: boolean;
  setPasswordRecovery: (v: boolean) => void;
  /** Always-current state, safe to read inside async callbacks without stale closures. */
  stateRef: React.MutableRefObject<ZenosState>;
}

const ZenosContext = createContext<ZenosContextType | null>(null);

export const ZenosProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<ZenosState>(() => ({
    ...DEFAULT_STATE,
    theme: readLS<'dark' | 'light'>(LS.theme, 'light'),
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const [mounted, setMounted] = useState(false);
  const [showModal, setShowModal] = useState<string | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | string | null>(null);

  const [user, setUser] = useState<any | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  // True after the user opens a password-reset link from their email
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => typeof window !== 'undefined' && /type=recovery/.test(window.location.hash + window.location.search)
  );

  // Local mode = demo user, or Supabase not configured, or cloud load failed.
  const isOffline = !!user && (user.id === OFFLINE_USER_ID || !SUPABASE_CONFIGURED);
  const offlineRef = useRef(isOffline);
  offlineRef.current = isOffline;
  const userRef = useRef(user);
  userRef.current = user;

  const reportError = (what: string, err: unknown) => {
    console.error(what, err);
    setSyncError(`${what}: ${(err as any)?.message || 'unknown error'}`);
  };

  const loadLocalData = () => {
    setState(s => ({
      ...s,
      tasks: readLS<Task[]>(LS.tasks, []),
      categories: readLS<Category[]>(LS.categories, DEFAULT_CATEGORIES),
      vault: readLS<VaultItem[]>(LS.vault, []),
      meetings: readLS<Meeting[]>(LS.meetings, []),
      danteHistory: readLS<DanteMessage[]>(LS.dante, []),
      completionLog: readLS<string[]>(LS.completion, []),
    }));
  };

  // Persist everything to localStorage while in local mode
  useEffect(() => {
    if (!isOffline) return;
    writeLS(LS.tasks, state.tasks);
    writeLS(LS.categories, state.categories);
    writeLS(LS.vault, state.vault);
    writeLS(LS.meetings, state.meetings || []);
    writeLS(LS.dante, state.danteHistory.slice(-DANTE_HISTORY_LIMIT));
    writeLS(LS.completion, state.completionLog.slice(-2000));
  }, [isOffline, state.tasks, state.categories, state.vault, state.meetings, state.danteHistory, state.completionLog]);

  useEffect(() => { writeLS(LS.theme, state.theme); }, [state.theme]);

  const fetchUserData = async (userId: string) => {
    if (!SUPABASE_CONFIGURED || userId === OFFLINE_USER_ID) {
      loadLocalData();
      return;
    }
    try {
      const [tasksRes, catsRes, vaultRes, meetRes, danteRes] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: true }),
        supabase.from('categories').select('*'),
        supabase.from('vault_items').select('*').order('added_at', { ascending: false }),
        supabase.from('meetings').select('*').order('date', { ascending: true }),
        supabase.from('dante_messages').select('*').order('created_at', { ascending: false }).limit(DANTE_HISTORY_LIMIT),
      ]);
      if (tasksRes.error) throw tasksRes.error;
      if (catsRes.error) throw catsRes.error;
      if (vaultRes.error) throw vaultRes.error;
      if (meetRes.error) console.warn('meetings table missing? Run supabase-schema-update.sql', meetRes.error);
      if (danteRes.error) console.warn('dante_messages table missing? Run supabase-schema-update.sql', danteRes.error);

      let dbCats = catsRes.data || [];
      if (dbCats.length === 0) {
        const { data: inserted, error } = await supabase
          .from('categories')
          .insert(DEFAULT_CATEGORIES.map(d => ({ label: d.label, color: d.color, slug: d.id, user_id: userId })))
          .select();
        if (error) console.error('Failed to seed default categories:', error);
        else if (inserted) dbCats = inserted;
      }

      const tasks = (tasksRes.data || []).map(mapTask);
      setState(s => ({
        ...s,
        tasks,
        completionLog: completionLogFromTasks(tasks),
        categories: dbCats.map((c: any) => ({ id: c.id, label: c.label, color: c.color || '#888' })),
        vault: (vaultRes.data || []).map((v: any) => ({
          id: v.id,
          type: (v.type || 'link') as 'file' | 'link',
          name: v.name,
          detail: v.detail || '',
          url: v.url || '',
          addedAt: v.added_at,
        })),
        meetings: (meetRes.data || []).map(mapMeeting),
        danteHistory: (danteRes.data || []).reverse().map((dm: any) => ({
          role: dm.role,
          content: dm.content,
          ts: new Date(dm.created_at).getTime(),
        })),
      }));
      setSyncError(null);
    } catch (err) {
      reportError('Could not load your data from the cloud', err);
    }
  };

  // Session tracking with Supabase Auth
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setMounted(true);
      return;
    }

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (session) {
          setUser(session.user);
          if (session.provider_token) setAccessTokenState(session.provider_token);
          setIsLoadingData(true);
          await fetchUserData(session.user.id);
        }
      } catch (err) {
        console.error('Initial session fetch failed:', err);
      } finally {
        setIsLoadingData(false);
        setMounted(true);
      }
    };
    init();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'INITIAL_SESSION') return; // handled by init()
      if (session) {
        setUser(session.user);
        if (session.provider_token) setAccessTokenState(session.provider_token);
        if (event === 'SIGNED_IN') {
          // Don't await inside the callback (supabase-js deadlock warning); defer it.
          setTimeout(async () => {
            setIsLoadingData(true);
            await fetchUserData(session.user.id);
            setIsLoadingData(false);
          }, 0);
        }
      } else if (userRef.current?.id !== OFFLINE_USER_ID) {
        setUser(null);
        setAccessTokenState(null);
        setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
      }
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  // Never let the loading screen hang
  useEffect(() => {
    if (!isLoadingData) return;
    const timer = setTimeout(() => setIsLoadingData(false), 8000);
    return () => clearTimeout(timer);
  }, [isLoadingData]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  // ---------- Google Calendar ----------
  const fetchGoogleEvents = async () => {
    const token = accessToken;
    if (!token) return;
    setLoadingEvents(true);
    try {
      const items = await fetchGoogleCalendarEvents(token, state.calYear, state.calMonth);
      setGoogleEvents(items);
    } catch (err) {
      console.error('Failed to load Google Calendar events:', err);
      if (err instanceof Error && err.message.toLowerCase().includes('unauthorized')) {
        setAccessTokenState(null);
      }
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (accessToken) fetchGoogleEvents();
  }, [accessToken, state.calYear, state.calMonth]);

  /**
   * Sign in with Google. Plain sign-in only asks for name + email (no Google review needed).
   * Pass withCalendar=true from "Connect Google Calendar" to request Calendar access separately.
   */
  const loginWithGoogle = async (withCalendar = false) => {
    if (!SUPABASE_CONFIGURED) throw new Error('Google sign-in needs Supabase to be configured.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${withCalendar ? '/calendar' : '/'}`,
        ...(withCalendar
          ? {
              scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
              queryParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
            }
          : {}),
      },
    });
    if (error) throw error;
  };

  const logOut = async () => {
    try {
      if (SUPABASE_CONFIGURED && user?.id !== OFFLINE_USER_ID) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } catch (error) {
      console.error('Sign-out failed:', error);
    } finally {
      setUser(null);
      setAccessTokenState(null);
      setGoogleEvents([]);
      setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
    }
  };

  const requireCloudAccount = () => {
    if (!userRef.current || offlineRef.current) throw new Error('Sign in to manage your account.');
    return userRef.current.id as string;
  };

  const exportMyData = async () => {
    const id = requireCloudAccount();
    const data = await exportAccountData(supabase, id);
    // Do not download another session's data if the user changed during export.
    if (userRef.current?.id !== id) throw new Error('Your session changed. Please try again.');
    downloadAccountData(data, localDateStr());
  };

  const deleteMyAccount = async () => {
    requireCloudAccount();
    await deleteAccountData(supabase);
    // The deleted user's refresh token is no longer valid. Clear the local session.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setAccessTokenState(null);
    setGoogleEvents([]);
    setLiveOpen(false);
    setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
    if (error) throw new Error('Account deleted, but session cleanup failed. Please reload the page.');
  };

  const getAuthToken = useCallback(async () => {
    if (!SUPABASE_CONFIGURED || userRef.current?.id === OFFLINE_USER_ID) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);

  const updateState = (updates: Partial<ZenosState>) => setState(s => ({ ...s, ...updates }));
  const toggleTheme = () => setState(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));

  // ---------- Tasks ----------
  const addTask = async (taskData: Omit<Task, 'id'>): Promise<Task | null> => {
    if (!userRef.current) return null;
    if (offlineRef.current) {
      const task: Task = { ...taskData, id: newId(), steps: taskData.steps || [] };
      setState(s => ({ ...s, tasks: [...s.tasks, task] }));
      return task;
    }
    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          user_id: userRef.current.id,
          title: taskData.title,
          cat: taskData.cat,
          status: taskData.status,
          date: taskData.date,
          reminder: taskData.reminder,
          note: taskData.note,
          progress: taskData.progress,
          steps: taskData.steps || [],
          completed_at: taskData.status === 'done' ? new Date().toISOString() : null,
        })
        .select()
        .single();
      if (error) throw error;
      const task = mapTask(data);
      setState(s => ({ ...s, tasks: [...s.tasks, task] }));
      return task;
    } catch (err) {
      reportError('Could not save task', err);
      return null;
    }
  };

  const editTask = async (id: number | string, rawUpdates: Partial<Task>) => {
    if (!userRef.current) return;
    // Keep completedAt in sync when the status is changed from the edit form
    const prev = stateRef.current.tasks.find(t => t.id === id);
    const updates: Partial<Task> = { ...rawUpdates };
    if (prev && updates.status && updates.status !== prev.status && updates.completedAt === undefined) {
      updates.completedAt = updates.status === 'done' ? new Date().toISOString() : null;
      if (updates.status === 'done') setState(s => ({ ...s, completionLog: [...s.completionLog, today()] }));
    }
    const apply = () => setState(s => ({ ...s, tasks: s.tasks.map(t => (t.id === id ? { ...t, ...updates } : t)) }));
    if (offlineRef.current) return apply();
    try {
      const { error } = await supabase
        .from('tasks')
        .update(compact({
          title: updates.title,
          cat: updates.cat,
          status: updates.status,
          date: updates.date,
          reminder: updates.reminder,
          note: updates.note,
          progress: updates.progress,
          steps: updates.steps,
          completed_at: updates.completedAt,
        }))
        .eq('id', id);
      if (error) throw error;
      apply();
    } catch (err) {
      reportError('Could not update task', err);
    }
  };

  const deleteTask = async (id: number | string) => {
    if (!userRef.current) return;
    const apply = () => setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }));
    if (offlineRef.current) return apply();
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      apply();
    } catch (err) {
      reportError('Could not delete task', err);
    }
  };

  const toggleTaskDone = async (id: number | string) => {
    const task = stateRef.current.tasks.find(t => t.id === id);
    if (!task || !userRef.current) return;
    const isDone = task.status === 'done';
    const status = isDone ? ('inprogress' as const) : ('done' as const);
    const progress = isDone ? (task.progress === 100 ? 50 : task.progress) : 100;
    const completedAt = isDone ? null : new Date().toISOString();

    const apply = () =>
      setState(s => ({
        ...s,
        tasks: s.tasks.map(t => (t.id === id ? { ...t, status, progress, completedAt } : t)),
        completionLog: isDone ? s.completionLog : [...s.completionLog, today()],
      }));

    if (offlineRef.current) return apply();
    try {
      const { error } = await supabase.from('tasks').update({ status, progress, completed_at: completedAt }).eq('id', id);
      if (error) throw error;
      apply();
    } catch (err) {
      reportError('Could not update task', err);
    }
  };

  // ---------- Categories ----------
  const addCategory = async (label: string, color: string) => {
    if (!userRef.current) return;
    if (offlineRef.current) {
      setState(s => ({ ...s, categories: [...s.categories, { id: newId(), label, color }] }));
      return;
    }
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({ user_id: userRef.current.id, label, color, slug: label.toLowerCase().replace(/\s+/g, '-') })
        .select()
        .single();
      if (error) throw error;
      setState(s => ({ ...s, categories: [...s.categories, { id: data.id, label: data.label, color: data.color || '#888' }] }));
    } catch (err) {
      reportError('Could not save category', err);
    }
  };

  // ---------- Vault ----------
  const addVaultItem = async (item: Omit<VaultItem, 'id' | 'addedAt'>) => {
    if (!userRef.current) return;
    if (offlineRef.current) {
      setState(s => ({ ...s, vault: [{ ...item, id: newId(), addedAt: new Date().toISOString() }, ...s.vault] }));
      return;
    }
    try {
      const { data, error } = await supabase
        .from('vault_items')
        .insert({ user_id: userRef.current.id, type: item.type, name: item.name, detail: item.detail, url: item.url || '' })
        .select()
        .single();
      if (error) throw error;
      const mapped: VaultItem = {
        id: data.id,
        type: (data.type || 'link') as 'file' | 'link',
        name: data.name,
        detail: data.detail || '',
        url: data.url || '',
        addedAt: data.added_at,
      };
      setState(s => ({ ...s, vault: [mapped, ...s.vault] }));
    } catch (err) {
      reportError('Could not save vault item', err);
    }
  };

  const deleteVaultItem = async (id: string) => {
    if (!userRef.current) return;
    const apply = () => setState(s => ({ ...s, vault: s.vault.filter(v => v.id !== id) }));
    if (offlineRef.current) return apply();
    try {
      const { error } = await supabase.from('vault_items').delete().eq('id', id);
      if (error) throw error;
      apply();
    } catch (err) {
      reportError('Could not delete vault item', err);
    }
  };

  // ---------- Meetings (now persisted) ----------
  const addMeeting = async (m: NewMeeting): Promise<Meeting | null> => {
    if (!userRef.current) return null;
    if (offlineRef.current) {
      const meeting: Meeting = { ...m, id: newId(), createdAt: new Date().toISOString() };
      setState(s => ({ ...s, meetings: [meeting, ...(s.meetings || [])] }));
      return meeting;
    }
    try {
      const { data, error } = await supabase
        .from('meetings')
        .insert({ ...meetingToRow(m), user_id: userRef.current.id })
        .select()
        .single();
      if (error) throw error;
      const meeting = mapMeeting(data);
      setState(s => ({ ...s, meetings: [meeting, ...(s.meetings || [])] }));
      return meeting;
    } catch (err) {
      reportError('Could not save meeting', err);
      return null;
    }
  };

  /** persist:false updates the screen only (used by the stopwatch tick); persist on pause/stop. */
  const updateMeeting = async (id: string, updates: Partial<Meeting>, opts: { persist?: boolean } = {}) => {
    const persist = opts.persist ?? true;
    setState(s => ({ ...s, meetings: (s.meetings || []).map(m => (m.id === id ? { ...m, ...updates } : m)) }));
    if (!persist || offlineRef.current || !userRef.current) return;
    try {
      const { error } = await supabase.from('meetings').update(meetingToRow(updates)).eq('id', id);
      if (error) throw error;
    } catch (err) {
      reportError('Could not update meeting', err);
    }
  };

  const deleteMeeting = async (id: string) => {
    if (!userRef.current) return;
    const apply = () => setState(s => ({ ...s, meetings: (s.meetings || []).filter(m => m.id !== id) }));
    if (offlineRef.current) return apply();
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', id);
      if (error) throw error;
      apply();
    } catch (err) {
      reportError('Could not delete meeting', err);
    }
  };

  // ---------- Local mode ----------
  const loginOffline = (email?: string, name?: string) => {
    setIsLoadingData(false);
    setMounted(true);
    setUser({
      id: OFFLINE_USER_ID,
      email: email || 'offline-operator@system.io',
      user_metadata: { full_name: name || 'Offline Operator' },
    });
    loadLocalData();
  };

  // ---------- Dante chat memory ----------
  const saveDanteMessage = async (role: 'user' | 'assistant', content: string): Promise<DanteMessage> => {
    const msg: DanteMessage = { role, content, ts: Date.now() };
    setState(s => ({ ...s, danteHistory: [...s.danteHistory, msg].slice(-DANTE_HISTORY_LIMIT) }));
    if (userRef.current && !offlineRef.current) {
      const { error } = await supabase.from('dante_messages').insert({ user_id: userRef.current.id, role, content });
      if (error) console.error('Failed to save Dante message:', error);
    }
    return msg;
  };

  const clearDanteHistory = async () => {
    setState(s => ({ ...s, danteHistory: [] }));
    if (userRef.current && !offlineRef.current) {
      const { error } = await supabase.from('dante_messages').delete().eq('user_id', userRef.current.id);
      if (error) console.error('Failed to clear Dante history:', error);
    }
  };

  return (
    <ZenosContext.Provider
      value={{
        state,
        updateState,
        toggleTheme,
        toggleTaskDone,
        deleteTask,
        addTask,
        editTask,
        addCategory,
        addVaultItem,
        deleteVaultItem,
        addMeeting,
        updateMeeting,
        deleteMeeting,
        showModal,
        setShowModal,
        editTaskId,
        setEditTaskId,
        user,
        isOffline,
        accessToken,
        googleEvents,
        setGoogleEvents,
        loadingEvents,
        isLoadingData,
        syncError,
        loginWithGoogle,
        logOut,
        exportMyData,
        deleteMyAccount,
        fetchGoogleEvents,
        loginOffline,
        showBriefing,
        setShowBriefing,
        saveDanteMessage,
        clearDanteHistory,
        getAuthToken,
        liveOpen,
        setLiveOpen,
        passwordRecovery,
        setPasswordRecovery,
        stateRef,
      }}
    >
      {children}
    </ZenosContext.Provider>
  );
};

export const useZenos = () => {
  const ctx = useContext(ZenosContext);
  if (!ctx) throw new Error('useZenos must be used within ZenosProvider');
  return ctx;
};
