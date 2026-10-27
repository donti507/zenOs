import {useChallenges} from '../hooks/useChallenges';
import { useGallery } from '../hooks/useGallery';
import { useModelArena } from '../hooks/useModelArena';
import { useSpacePages } from '../hooks/useSpacePages';
import { useSemanticSearch } from '../hooks/useSemanticSearch';
import { useLectures } from '../hooks/useLectures';
import { MEMORY_LIMIT, memoryFromRow, recentMemory, validateMemoryFact, type DanteMemory } from '../../shared/danteMemory';
import { useDanteMemoryConfirmation } from '../components/DanteMemoryConfirmation';
import { mapTask, mapMeeting, mapCategory, mapVaultItem, completionLogFromTasks, mergeWorkspaceChange, insertWorkspaceRow, readWorkspaceChange, workspaceTopic, type WorkspaceChange, type WorkspaceTable } from '../lib/workspaceRealtime';
import { planExam, remainingExamTasks, examSnapshot, type ExamDraft } from '../lib/examPlanner';
import { applyPostponement } from '../lib/postponement';
import { useFocusTimer, type FocusSession } from '../hooks/useFocusTimer';
import { useTaskNotifications } from '../hooks/useTaskNotifications';
import { isRecurrence, calendarDate, updateTaskOccurrence } from '../lib/recurrence';
import type { DanteUsage } from '../../shared/danteUsage';
import { DANTE_USAGE_CHANGED } from '../lib/usageEvents';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { ZenosState, Task, Category, VaultItem, Meeting, DanteMessage } from '../types';
import { today, localDateStr } from '../lib/utils';
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase';
import { exportAccountData, deleteAccountData, downloadAccountData } from '../lib/accountData';
import { shouldOfferLocalImport, declineLocalImport, importLocalData } from '../lib/localImport';
import { useGoogleCalendar, GOOGLE_CONNECT_PENDING, type GoogleProviderSession } from '../hooks/useGoogleCalendar';
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
  danteMemory: [],
  lectures: [],
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
  memory: 'zenos_dante_memory',
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



export type NewMeeting = Omit<Meeting, 'id' | 'createdAt'>;

interface ZenosContextType extends ReturnType<typeof useGallery>, ReturnType<typeof useChallenges> {
  focusSession: FocusSession | null;
  startTaskFocus: (taskId: Task['id']) => void;
  stopTaskFocus: () => void;
  state: ZenosState;
  arenaRound: import('../../shared/arena').ArenaRound | null;
  arenaRunning: boolean;
  arenaVoting: boolean;
  arenaError: string | null;
  arenaBoardError: string | null;
  arenaLeaderboard: import('../../shared/arena').ArenaLeader[];
  compareArena: (prompt:string,models:[string,string])=>Promise<void>;
  cancelArena: ()=>void;
  voteArena: (winner:import('../../shared/arena').ArenaWinner)=>Promise<void>;
  refreshArenaLeaderboard: ()=>Promise<void>;
  spacePages: import('../../shared/space').SpacePage[];
  changeSpaceWidget: (id:string, action:import('../../shared/space').SpaceWidgetAction) => Promise<void>;
  spacePagesLoading: boolean;
  spacePagesError: string | null;
  refreshSpacePages: () => Promise<void>;
  createSpacePage: (title:string,slug:string) => Promise<import('../../shared/space').SpaceSnapshot>;
  loadSpacePage: (slug:string) => Promise<import('../../shared/space').SpaceSnapshot>;
  spaceHistory: (pageId:string,offset?:number) => Promise<import('../../shared/space').SpaceVersionInfo[]>;
  readSpaceVersion: (pageId:string,id:string) => Promise<import('../../shared/space').SpaceVersion>;
  editSpacePage: (snapshot:import('../../shared/space').SpaceSnapshot,prompt:string,model:string,requestId:string,signal:AbortSignal) => Promise<import('../../shared/space').SpaceSnapshot>;
  restoreSpaceVersion: (snapshot:import('../../shared/space').SpaceSnapshot,sourceId:string,requestId:string) => Promise<import('../../shared/space').SpaceSnapshot>;
  setSpacePermissions: (snapshot:import('../../shared/space').SpaceSnapshot,permissions:import('../../shared/space').SpacePermissions) => Promise<import('../../shared/space').SpacePage>;
  checkSpaceAccess: (pageId:string,versionId:string,method:'tasks'|'events') => Promise<boolean>;
  searchEnabled: boolean;
  searchIndexPending: number;
  searchIndexError: string | null;
  indexNotes: (signal?:AbortSignal) => Promise<{indexed:number;pending:number}>;
  searchNotes: (query:string,signal?:AbortSignal) => Promise<import('../../shared/search').SearchResponse>;
  getSearchSource: (type:import('../../shared/search').SearchType,id:string,signal?:AbortSignal) => Promise<import('../../shared/search').SearchSource>;
  lecturesLoading: boolean;
  lecturesError: string | null;
  refreshLectures: () => Promise<void>;
  loadLecture: (id: string) => Promise<import('../../shared/lectures').Lecture>;
  saveLecture: (lecture: import('../../shared/lectures').Lecture) => Promise<import('../../shared/lectures').Lecture>;
  reviewLectureCard: (id: string, index: number, known: boolean) => Promise<void>;
  addLectureActionTask: (id: string, index: number) => Promise<void>;
  updateState: (updates: Partial<ZenosState>) => void;
  toggleTheme: () => void;
  toggleTaskDone: (id: number | string) => Promise<void>;
  deleteTask: (id: number | string) => Promise<void>;
  saveExamPlan: (draft: ExamDraft, expected?: Task[]) => Promise<void>;
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
  googleConnected: boolean;
  googleCalendarError: string | null;
  getGoogleAccessToken: (forceRefresh?: boolean) => Promise<string>;
  disconnectGoogleCalendar: () => Promise<void>;
  googleEvents: any[];
  setGoogleEvents: React.Dispatch<React.SetStateAction<any[]>>;
  loadingEvents: boolean;
  isLoadingData: boolean;
  syncError: string | null;
  loginWithGoogle: (withCalendar?: boolean) => Promise<void>;
  logOut: () => Promise<void>;
  localImportOpen: boolean;
  localImportBusy: boolean;
  localImportError: string | null;
  importLocalWorkspace: () => Promise<void>;
  declineLocalWorkspace: () => void;
  exportMyData: () => Promise<void>;
  deleteMyAccount: () => Promise<void>;
  fetchGoogleEvents: () => Promise<void>;
  loginOffline: (email?: string, name?: string) => void;
  showBriefing: boolean;
  setShowBriefing: (show: boolean) => void;
  saveDanteMessage: (role: 'user' | 'assistant', content: string) => Promise<DanteMessage>;
  clearDanteHistory: () => Promise<void>;
  memoryLoading: boolean;
  memoryError: string | null;
  refreshDanteMemory: () => Promise<void>;
  rememberFact: (fact: string) => Promise<DanteMemory>;
  forgetFact: (id: string) => Promise<void>;
  confirmForgetFact: (fact: DanteMemory) => Promise<boolean>;
  notificationPermission: NotificationPermission | 'unsupported';
  canAskNotifications: boolean;
  enableTaskNotifications: () => Promise<void>;
  dismissTaskNotifications: () => void;
  getAuthToken: () => Promise<string | null>;
  danteUsage: DanteUsage | null;
  danteUsageError: string | null;
  refreshDanteUsage: () => Promise<DanteUsage | null>;
  billing: { enabled: boolean; plan: 'free' | 'pro'; hasCustomer?: boolean } | null;
  refreshBilling: () => Promise<void>;
  startBilling: (action: 'checkout' | 'portal') => Promise<void>;
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
  const memoryRef = useRef(state.danteMemory || []); memoryRef.current = state.danteMemory || [];
  const memoryRead = useRef(0);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  const [localImportOpen, setLocalImportOpen] = useState(false);
  const [localImportBusy, setLocalImportBusy] = useState(false);
  const [localImportError, setLocalImportError] = useState<string | null>(null);
  const importRunning = useRef(false);
  const [cloudLoadedFor, setCloudLoadedFor] = useState<string | null>(null);
  const [usageState, setUsageState] = useState<{ userId: string | null; data: DanteUsage | null; error: string | null }>({ userId: null, data: null, error: null });
  const usageRequest = useRef(0);
  const taskReloadRequest = useRef(0);
  const workspaceOwner = useRef<string | null>(null);
  const workspaceReadVersion = useRef(0);
  const workspaceSessionGeneration = useRef(0);
  const deletedWorkspaceRows = useRef(new Set<string>());
  const insertCloudRow = (state: ZenosState, owner: string, table: WorkspaceTable, row: Record<string, any>) =>
    workspaceOwner.current === owner && !deletedWorkspaceRows.current.has(`${table}:${row.id}`) ? insertWorkspaceRow(state, table, row) : state;
  const pendingWorkspaceReads = useRef(new Set<{ owner: string; changes: WorkspaceChange[] }>());
  const [mounted, setMounted] = useState(false);
  const [showModal, setShowModal] = useState<string | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | string | null>(null);

  const [user, setUser] = useState<any | null>(null);
  const [googleProviderSession, setGoogleProviderSession] = useState<GoogleProviderSession | null>(null);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [googleReadError, setGoogleReadError] = useState<string | null>(null);
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
  const { confirmForgetFact, dialog: memoryDialog } = useDanteMemoryConfirmation(user?.id ?? null);
  const getAuthToken = useCallback(async () => {
    if (!SUPABASE_CONFIGURED || userRef.current?.id === OFFLINE_USER_ID) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);
  const { accessToken, googleConnected, googleCalendarError, getGoogleAccessToken, disconnectGoogleCalendar: disconnectGoogle } = useGoogleCalendar({ userId: user?.id ?? null, isOffline, getAuthToken, providerSession: googleProviderSession });
  const googleReadRequest = useRef(0);
  const disconnectGoogleCalendar = async () => {
    ++googleReadRequest.current;
    setGoogleEvents([]);
    await disconnectGoogle();
  };
  const captureGoogleSession = (session: any) => {
    // Only a deliberate Calendar consent flow uploads provider credentials.
    let requested = false;
    try { requested = sessionStorage.getItem(GOOGLE_CONNECT_PENDING) === 'true'; } catch { /* storage unavailable */ }
    if (requested && session.provider_refresh_token && session.access_token) setGoogleProviderSession({ userId: session.user.id, refreshToken: session.provider_refresh_token, authToken: session.access_token });
  };
  const lectures = useLectures({ ownerId: user?.id ?? null, isOffline, stateRef, setState, isCurrent: () => !!userRef.current && userRef.current.id === user?.id && offlineRef.current === isOffline && workspaceOwner.current === (isOffline ? null : user?.id) });
  const arena = useModelArena({ownerId:user?.id??null,isOffline,getToken:getAuthToken,isCurrent:()=>!!userRef.current&&userRef.current.id===user?.id&&offlineRef.current===isOffline&&workspaceOwner.current===(isOffline?null:user?.id)});
  const spaces = useSpacePages({ownerId:user?.id??null,isOffline,getToken:getAuthToken,isCurrent:()=>!!userRef.current&&userRef.current.id===user?.id&&offlineRef.current===isOffline&&workspaceOwner.current===(isOffline?null:user?.id)});
  const gallery = useGallery({ownerId:user?.id??null,isOffline,getToken:getAuthToken,refreshSpacePages:spaces.refreshSpacePages,isCurrent:()=>!!userRef.current&&userRef.current.id===user?.id&&offlineRef.current===isOffline&&workspaceOwner.current===(isOffline?null:user?.id)});
  const challenges=useChallenges({ownerId:user?.id??null,isOffline,getToken:getAuthToken,pageRevision:spaces.spacePages.map(page=>page.id).join(','),isCurrent:()=>!!userRef.current&&userRef.current.id===user?.id&&offlineRef.current===isOffline&&workspaceOwner.current===(isOffline?null:user?.id)});
  const semanticSearch = useSemanticSearch({ownerId:user?.id??null,isOffline,getToken:getAuthToken,state,stateRef,isCurrent:()=>!!userRef.current&&userRef.current.id===user?.id&&offlineRef.current===isOffline&&workspaceOwner.current===(isOffline?null:user?.id)});
  const focus = useFocusTimer(user?.id || null);
  const taskNotifications = useTaskNotifications(state.tasks, user?.id || null);

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
      danteMemory: recentMemory(readLS(LS.memory, []), MEMORY_LIMIT),
      lectures: [],
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
    writeLS(LS.memory, state.danteMemory || []);
    writeLS(LS.completion, state.completionLog.slice(-2000));
  }, [isOffline, state.tasks, state.categories, state.vault, state.meetings, state.danteHistory, state.danteMemory, state.completionLog]);

  useEffect(() => { writeLS(LS.theme, state.theme); }, [state.theme]);

  const fetchUserData = async (userId: string, options: { workspaceOnly?: boolean } = {}) => {
    if (!SUPABASE_CONFIGURED || userId === OFFLINE_USER_ID) {
      loadLocalData();
      return;
    }
    const version = ++workspaceReadVersion.current;
    const read = { owner: userId, changes: [] as WorkspaceChange[] };
    pendingWorkspaceReads.current.add(read);
    const current = () => workspaceOwner.current === userId && workspaceReadVersion.current === version;
    try {
      const [tasksRes, catsRes, vaultRes, meetRes, danteRes] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: true }),
        supabase.from('categories').select('*'),
        supabase.from('vault_items').select('*').order('added_at', { ascending: false }),
        supabase.from('meetings').select('*').order('date', { ascending: true }),
        options.workspaceOnly ? Promise.resolve({ data: [], error: null }) : supabase.from('dante_messages').select('*').order('created_at', { ascending: false }).limit(DANTE_HISTORY_LIMIT),
      ]);
      if (tasksRes.error) throw tasksRes.error;
      if (catsRes.error) throw catsRes.error;
      if (vaultRes.error) throw vaultRes.error;
      if (meetRes.error) console.warn('meetings table missing? Run supabase-schema-update.sql', meetRes.error);
      if (danteRes.error) console.warn('dante_messages table missing? Run supabase-schema-update.sql', danteRes.error);

      if (!current()) return;
      let dbCats = catsRes.data || [];
      if (dbCats.length === 0 && !options.workspaceOnly) {
        const { data: inserted, error } = await supabase
          .from('categories')
          .insert(DEFAULT_CATEGORIES.map(d => ({ label: d.label, color: d.color, slug: d.id, user_id: userId })))
          .select();
        if (error) console.error('Failed to seed default categories:', error);
        else if (inserted) dbCats = inserted;
      }

      if (!current()) return;
      const tasks = (tasksRes.data || []).map(mapTask);
      setState(s => current() ? read.changes.reduce(mergeWorkspaceChange, {
        ...s,
        tasks,
        completionLog: completionLogFromTasks(tasks),
        categories: dbCats.map(mapCategory),
        vault: (vaultRes.data || []).map(mapVaultItem),
        meetings: (meetRes.data || []).map(mapMeeting),
        danteHistory: options.workspaceOnly ? s.danteHistory : (danteRes.data || []).reverse().map((dm: any) => ({
          role: dm.role,
          content: dm.content,
          ts: new Date(dm.created_at).getTime(),
        })),
      }) : s);
      setSyncError(null);
      setCloudLoadedFor(userId);
    } catch (err) {
      if (current()) reportError('Could not load your data from the cloud', err);
    } finally { pendingWorkspaceReads.current.delete(read); }
  };

  useEffect(() => {
    setLocalImportError(null);
    if (!user || isOffline || cloudLoadedFor !== user.id || isLoadingData) {
      setLocalImportOpen(false);
      return;
    }
    try { setLocalImportOpen(shouldOfferLocalImport(localStorage, user.id)); }
    catch { setLocalImportOpen(false); /* malformed or unavailable storage: preserve it */ }
  }, [user?.id, isOffline, cloudLoadedFor, isLoadingData]);

  const declineLocalWorkspace = () => {
    if (importRunning.current || !userRef.current || offlineRef.current) return;
    try {
      declineLocalImport(localStorage, userRef.current.id);
      setLocalImportOpen(false);
      setLocalImportError(null);
    } catch { setLocalImportError('Could not save your choice. Please allow browser storage and try again.'); }
  };

  const importLocalWorkspace = async () => {
    if (importRunning.current || !userRef.current || offlineRef.current) return;
    const userId = userRef.current.id;
    importRunning.current = true;
    setLocalImportBusy(true);
    setLocalImportError(null);
    try {
      await importLocalData(supabase, localStorage, userId);
      if (userRef.current?.id === userId) {
        setLocalImportOpen(false);
        await fetchUserData(userId);
      }
    } catch (err) {
      if (userRef.current?.id === userId) setLocalImportError((err as Error).message);
    } finally { importRunning.current = false; setLocalImportBusy(false); }
  };

  // Session tracking with Supabase Auth
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setMounted(true);
      return;
    }

    let active = true;
    const init = async () => {
      const generation = workspaceSessionGeneration.current;
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || generation !== workspaceSessionGeneration.current) return;
        const session = data?.session;
        if (session) {
          workspaceOwner.current = session.user.id;
          setUser(session.user);
          captureGoogleSession(session);
          setIsLoadingData(true);
          await fetchUserData(session.user.id);
        }
      } catch (err) {
        console.error('Initial session fetch failed:', err);
      } finally {
        if (active) {
          if (generation === workspaceSessionGeneration.current) setIsLoadingData(false);
          setMounted(true);
        }
      }
    };
    init();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'INITIAL_SESSION') return; // handled by init()
      ++workspaceSessionGeneration.current;
      if (event === 'TOKEN_REFRESHED' && userRef.current?.id === OFFLINE_USER_ID) return;
      if (session) {
        if (workspaceOwner.current !== session.user.id) {
          setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
          setCloudLoadedFor(null);
        }
        workspaceOwner.current = session.user.id;
        setUser(session.user);
        captureGoogleSession(session);
        if (event === 'SIGNED_IN') {
          // Don't await inside the callback (supabase-js deadlock warning); defer it.
          setTimeout(async () => {
            setIsLoadingData(true);
            await fetchUserData(session.user.id);
            setIsLoadingData(false);
          }, 0);
        }
      } else if (userRef.current?.id !== OFFLINE_USER_ID) {
        workspaceOwner.current = null;
        setCloudLoadedFor(null);
        setUser(null);
        setGoogleProviderSession(null);
        setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
      }
    });

    return () => { active = false; listener?.subscription?.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !user || isOffline || cloudLoadedFor !== user.id) return;
    const owner = user.id as string;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const current = () => active && workspaceOwner.current === owner && !offlineRef.current;
    const receive = (message: unknown) => {
      if (!current()) return;
      const change = readWorkspaceChange(message, owner);
      if (!change) return;
      const key = `${change.table}:${change.row.id}`;
      if (change.operation === 'DELETE') deletedWorkspaceRows.current.add(key);
      else deletedWorkspaceRows.current.delete(key);
      for (const read of pendingWorkspaceReads.current) if (read.owner === owner) read.changes.push(change);
      setState(s => current() ? mergeWorkspaceChange(s, change) : s);
    };
    const unavailable = 'Live sync is unavailable. Reload to check for the latest changes.';
    void (async () => {
      try {
        await supabase.realtime.setAuth();
        if (!current()) return;
        channel = supabase.channel(workspaceTopic(owner), { config: { private: true } })
          .on('broadcast', { event: 'INSERT' }, receive)
          .on('broadcast', { event: 'UPDATE' }, receive)
          .on('broadcast', { event: 'DELETE' }, receive)
          .subscribe(status => {
            if (!current()) return;
            if (status === 'SUBSCRIBED') {
              setSyncError(error => error === unavailable ? null : error);
              void fetchUserData(owner, { workspaceOnly: true });
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncError(error => error || unavailable);
          });
      } catch { if (current()) setSyncError(error => error || unavailable); }
    })();
    return () => {
      active = false;
      deletedWorkspaceRows.current.clear();
      if (channel) void supabase.removeChannel(channel).catch(() => {});
    };
  }, [user?.id, isOffline, cloudLoadedFor]);

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
    const owner = userRef.current?.id;
    if (!owner || offlineRef.current || !googleConnected) return;
    const request = ++googleReadRequest.current;
    const { calYear, calMonth } = stateRef.current;
    setLoadingEvents(true); setGoogleReadError(null);
    try {
      const items = await fetchGoogleCalendarEvents(getGoogleAccessToken, calYear, calMonth);
      if (userRef.current?.id === owner && request === googleReadRequest.current && !offlineRef.current) setGoogleEvents(items);
    } catch {
      if (userRef.current?.id === owner && request === googleReadRequest.current) setGoogleReadError('Google Calendar could not sync. Try again or reconnect Calendar.');
      // Never log Calendar responses or tokens.
    } finally {
      if (request === googleReadRequest.current) setLoadingEvents(false);
    }
  };

  useEffect(() => {
    ++googleReadRequest.current;
    setGoogleEvents([]);
    setLoadingEvents(false); setGoogleReadError(null);
    if (googleConnected) void fetchGoogleEvents();
    return () => { ++googleReadRequest.current; };
  }, [user?.id, isOffline, googleConnected, state.calYear, state.calMonth]);

  /**
   * Sign in with Google. Plain sign-in only asks for name + email (no Google review needed).
   * Pass withCalendar=true from "Connect Google Calendar" to request Calendar access separately.
   */
  const loginWithGoogle = async (withCalendar = false) => {
    if (!SUPABASE_CONFIGURED) throw new Error('Google sign-in needs Supabase to be configured.');
    if (withCalendar) {
      try { sessionStorage.setItem(GOOGLE_CONNECT_PENDING, 'true'); } catch { throw new Error('Allow session storage to connect Google Calendar.'); }
    }
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
    if (error) {
      if (withCalendar) sessionStorage.removeItem(GOOGLE_CONNECT_PENDING);
      throw error;
    }
  };

  const logOut = async () => {
    ++workspaceSessionGeneration.current;
    workspaceOwner.current = null;
    setCloudLoadedFor(null);
    try {
      if (SUPABASE_CONFIGURED && user?.id !== OFFLINE_USER_ID) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } catch (error) {
      console.error('Sign-out failed:', error);
    } finally {
      setUser(null);
      setGoogleProviderSession(null);
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
    workspaceOwner.current = null;
    setUser(null);
    setGoogleProviderSession(null);
    setGoogleEvents([]);
    setLiveOpen(false);
    setState(s => ({ ...DEFAULT_STATE, theme: s.theme }));
    if (error) throw new Error('Account deleted, but session cleanup failed. Please reload the page.');
  };

  const [billingState, setBillingState] = useState<{ owner: string | null; enabled: boolean; plan: 'free' | 'pro'; hasCustomer?: boolean } | null>(null);
  const billingRequest = useRef(0);
  const billingPlan = useRef<{ owner: string | null; plan: 'free' | 'pro' }>({ owner: null, plan: 'free' });
  const refreshBilling = useCallback(async () => {
    const owner = userRef.current?.id ?? null;
    const request = ++billingRequest.current;
    try {
      const token = owner && !offlineRef.current ? await getAuthToken() : null;
      if (owner && !offlineRef.current && !token) throw new Error('Missing session');
      const response = await fetch(token ? '/api/billing/account' : '/api/billing/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
      });
      if (!response.ok) throw new Error('Billing unavailable');
      const data = await response.json();
      if (request !== billingRequest.current || (userRef.current?.id ?? null) !== owner) return;
      const plan = data.plan === 'pro' ? 'pro' : 'free';
      const previous = billingPlan.current;
      billingPlan.current = { owner, plan };
      setBillingState({ owner, enabled: data.enabled === true, plan, hasCustomer: data.hasCustomer === true });
      if (owner && !offlineRef.current && (previous.owner === owner ? previous.plan !== plan : plan === 'pro')) window.dispatchEvent(new Event(DANTE_USAGE_CHANGED));
    } catch {
      if (request === billingRequest.current && (userRef.current?.id ?? null) === owner) setBillingState(null);
    }
  }, [getAuthToken]);
  useEffect(() => {
    void refreshBilling();
    window.addEventListener('focus', refreshBilling);
    return () => { ++billingRequest.current; window.removeEventListener('focus', refreshBilling); };
  }, [user?.id, refreshBilling]);
  const startBilling = useCallback(async (action: 'checkout' | 'portal') => {
    const owner = userRef.current?.id;
    if (!owner || offlineRef.current) throw new Error('Sign in to manage billing.');
    const token = await getAuthToken();
    if (!token || userRef.current?.id !== owner) throw new Error('Sign in again.');
    const response = await fetch(`/api/billing/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Could not open billing. Please try again.');
    const data = await response.json();
    const destination = new URL(data.url);
    if (destination.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(destination.hostname)) throw new Error('Invalid billing destination.');
    if (userRef.current?.id !== owner || offlineRef.current) return;
    window.location.assign(destination.href);
  }, [getAuthToken]);

  const refreshDanteUsage = useCallback(async (): Promise<DanteUsage | null> => {
    const userId = userRef.current?.id || null;
    const request = ++usageRequest.current;
    if (!userId || offlineRef.current) {
      const data: DanteUsage | null = userId ? { enabled: false } : null;
      setUsageState({ userId, data, error: null });
      return data;
    }
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Sign in again to check today’s usage.');
      if (userRef.current?.id !== userId) return null;
      const response = await fetch('/api/dante/usage', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error('Today’s usage is temporarily unavailable.');
      if (userRef.current?.id !== userId || request !== usageRequest.current) return null;
      setUsageState({ userId, data: body, error: null });
      return body;
    } catch (error) {
      if (userRef.current?.id === userId && request === usageRequest.current) {
        setUsageState({ userId, data: null, error: (error as Error).message });
      }
      return null;
    }
  }, [getAuthToken]);

  useEffect(() => {
    const refresh = () => { void refreshDanteUsage(); };
    refresh();
    window.addEventListener(DANTE_USAGE_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener(DANTE_USAGE_CHANGED, refresh); window.removeEventListener('focus', refresh); };
  }, [user?.id, refreshDanteUsage]);

  const resetsAt = usageState.data?.enabled ? usageState.data.resetsAt : null;
  useEffect(() => {
    if (!resetsAt) return;
    const delay = Math.max(1000, new Date(resetsAt).getTime() - Date.now() + 100);
    const timer = setTimeout(() => { void refreshDanteUsage(); }, Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [resetsAt, refreshDanteUsage]);

  const updateState = (updates: Partial<ZenosState>) => setState(s => ({ ...s, ...updates }));
  const toggleTheme = () => setState(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));

  // ---------- Tasks ----------
  const saveExamPlan = async (draft: ExamDraft, expected?: Task[]) => {
    const owner = userRef.current?.id;
    if (!owner) throw new Error('Sign in to save a plan.');
    const current = stateRef.current;
    const linked = new Set((current.meetings || []).map(m => m.googleEventId).filter(Boolean));
    const dates = [...(current.meetings || []).map(m => m.date), ...googleEvents.filter((e: any) => !linked.has(e.id)).map((e: any) => (e.start?.date || e.start?.dateTime || '').slice(0, 10))];
    const sessions = planExam(draft, today(), dates);
    if (expected && JSON.stringify(expected.map(t => t.examPlan?.topicId).sort()) !== JSON.stringify(draft.topics.map(t => t.id).sort())) throw new Error('Remaining topics changed. Close the planner and try again.');
    if (expected && JSON.stringify(examSnapshot(remainingExamTasks(current.tasks, draft.id))) !== JSON.stringify(examSnapshot(expected))) throw new Error('Plan changed. Close the planner and try again.');
    if (offlineRef.current) {
      setState(s => {
        if (userRef.current?.id !== owner) return s;
        if (expected && JSON.stringify(examSnapshot(remainingExamTasks(s.tasks, draft.id))) !== JSON.stringify(examSnapshot(expected))) return s;
        if (!expected && s.tasks.some(t => t.examPlan?.id === draft.id)) return s;
        const category = s.categories.find(c => c.label.trim().toLowerCase() === 'exams') || { id: newId(), label: 'Exams', color: '#8151eb' };
        const makeMetadata = (topicId: string) => ({ id: draft.id, name: draft.name.trim(), examDate: draft.examDate, minutesPerDay: draft.minutesPerDay, topicId });
        const tasks = expected ? s.tasks.map(t => {
          const session = sessions.find(x => t.examPlan?.id === draft.id && x.topicId === t.examPlan.topicId);
          return session && expected.some(e => e.id === t.id) ? applyPostponement(t, { date: session.date, examPlan: makeMetadata(session.topicId) }) : t;
        }) : [...s.tasks, ...sessions.map(x => ({ id: newId(), title: `${draft.name.trim()}: ${x.topic}`, cat: category.id, status: 'todo' as const, date: x.date, reminder: '', note: `${x.minutes}-minute study session`, progress: 0, steps: [{ id: x.topicId, label: x.topic, done: false }], examPlan: makeMetadata(x.topicId) }))];
        return { ...s, tasks, categories: s.categories.some(c => c.id === category.id) ? s.categories : [...s.categories, category] };
      });
      return;
    }
    const { data, error } = await supabase.rpc('save_exam_plan', { p_start_date: today(), p_owner: owner, p_draft: draft, p_sessions: sessions, p_expected: expected ? examSnapshot(expected) : null });
    if (error) throw new Error('Could not save the plan. Refresh and try again; apply the latest database migration if needed.');
    if (userRef.current?.id !== owner) return;
    setState(s => ({ ...s, tasks: [...s.tasks.filter(t => t.examPlan?.id !== draft.id), ...data.tasks.map(mapTask)], categories: s.categories.some(c => c.id === data.category.id) ? s.categories : [...s.categories, data.category] }));
  };

  const addTask = async (taskData: Omit<Task, 'id'>): Promise<Task | null> => {
    if (!userRef.current) return null;
    const ownerId = userRef.current.id;
    taskData = { ...taskData, postponedCount: 0, recurrence: isRecurrence(taskData.recurrence) ? taskData.recurrence : 'none' };
    if (taskData.recurrence !== 'none' && !calendarDate(taskData.date)) taskData.date = today();
    taskData.recurrenceDay = calendarDate(taskData.date)?.getDate() || null;
    if (offlineRef.current) {
      const task: Task = { ...taskData, id: newId(), steps: taskData.steps || [] };
      setState(s => ({ ...s, tasks: [...s.tasks, task] }));
      return task;
    }
    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          user_id: ownerId,
          title: taskData.title,
          cat: taskData.cat,
          status: taskData.status,
          date: taskData.date,
          reminder: taskData.reminder,
          recurrence: taskData.recurrence,
          recurrence_day: taskData.recurrenceDay,
          note: taskData.note,
          progress: taskData.progress,
          steps: taskData.steps || [],
          completed_at: taskData.status === 'done' ? new Date().toISOString() : null,
        })
        .select()
        .single();
      if (error) throw error;
      if (userRef.current?.id !== ownerId) return null;
      const task = mapTask(data);
      setState(s => insertCloudRow(s, ownerId, 'tasks', data));
      return task;
    } catch (err) {
      reportError('Could not save task', err);
      return null;
    }
  };

  const reloadCloudTasks = async (userId: string) => {
    const request = ++taskReloadRequest.current;
    const read = { owner: userId, changes: [] as WorkspaceChange[] };
    pendingWorkspaceReads.current.add(read);
    const current = () => workspaceOwner.current === userId && request === taskReloadRequest.current;
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      if (!current()) return;
      const tasks = (data || []).map(mapTask);
      setState(s => {
        if (!current()) return s;
        return read.changes.filter(change => change.table === 'tasks').reduce(mergeWorkspaceChange, { ...s, tasks, completionLog: completionLogFromTasks(tasks) });
      });
    } finally { pendingWorkspaceReads.current.delete(read); }
  };

  const editTask = async (id: number | string, rawUpdates: Partial<Task>) => {
    if (!userRef.current) return;
    const prev = stateRef.current.tasks.find(t => t.id === id);
    if (!prev) return;
    const updates = { ...rawUpdates };
    if (updates.recurrence !== undefined && !isRecurrence(updates.recurrence)) throw new Error('Invalid repeat option');
    if ((updates.recurrence || prev.recurrence || 'none') !== 'none' && !calendarDate(updates.date ?? prev.date)) updates.date = today();
    if ((updates.date !== undefined && updates.date !== prev.date) || (updates.recurrence !== undefined && updates.recurrence !== (prev.recurrence || 'none'))) {
      updates.recurrenceDay = calendarDate(updates.date ?? prev.date)?.getDate() || null;
    }
    if (updates.status && updates.status !== prev.status && updates.completedAt === undefined) updates.completedAt = updates.status === 'done' ? new Date().toISOString() : null;
    if (offlineRef.current) {
      setState(s => {
        const newlyDone = s.tasks.find(task => task.id === id)?.status !== 'done' && updates.status === 'done';
        const tasks = updateTaskOccurrence(s.tasks, id, updates, newId);
        return { ...s, tasks, completionLog: newlyDone ? [...s.completionLog, today()] : s.completionLog };
      });
      return;
    }
    try {
      const userId = userRef.current.id;
      const { error } = await supabase.from('tasks').update(compact({
        title: updates.title, cat: updates.cat, status: updates.status, date: updates.date,
        reminder: updates.reminder, note: updates.note, progress: updates.progress, steps: updates.steps,
        completed_at: updates.completedAt, recurrence: updates.recurrence, recurrence_day: updates.recurrenceDay,
      })).eq('id', id);
      if (error) throw error;
      // The database creates the next occurrence atomically; fetch it with its real ID.
      await reloadCloudTasks(userId);
    } catch (err) { reportError('Could not update task', err); }
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
    await editTask(id, {
      status: isDone ? 'inprogress' : 'done',
      progress: isDone ? (task.progress === 100 ? 50 : task.progress) : 100,
      completedAt: isDone ? null : new Date().toISOString(),
    });
  };

  // ---------- Categories ----------
  const addCategory = async (label: string, color: string) => {
    if (!userRef.current) return;
    const ownerId = userRef.current.id;
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
      setState(s => insertCloudRow(s, ownerId, 'categories', data));
    } catch (err) {
      reportError('Could not save category', err);
    }
  };

  // ---------- Vault ----------
  const addVaultItem = async (item: Omit<VaultItem, 'id' | 'addedAt'>) => {
    if (!userRef.current) return;
    const ownerId = userRef.current.id;
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
      setState(s => insertCloudRow(s, ownerId, 'vault_items', data));
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
    const ownerId = userRef.current.id;
    if (offlineRef.current) {
      const meeting: Meeting = { ...m, id: newId(), createdAt: new Date().toISOString() };
      setState(s => ({ ...s, meetings: [meeting, ...(s.meetings || [])] }));
      return meeting;
    }
    try {
      const { data, error } = await supabase
        .from('meetings')
        .insert({ ...meetingToRow(m), user_id: ownerId })
        .select()
        .single();
      if (error) throw error;
      if (userRef.current?.id !== ownerId) return null;
      const meeting = mapMeeting(data);
      setState(s => insertCloudRow(s, ownerId, 'meetings', data));
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
    ++workspaceSessionGeneration.current;
    workspaceOwner.current = null;
    setCloudLoadedFor(null);
    setIsLoadingData(false);
    setMounted(true);
    setUser({
      id: OFFLINE_USER_ID,
      email: email || 'offline-operator@system.io',
      user_metadata: { full_name: name || 'Offline Operator' },
    });
    loadLocalData();
  };

  // ---------- Durable Dante facts (separate from chat history) ----------
  const refreshDanteMemory = useCallback(async () => {
    const owner = userRef.current?.id;
    const request = ++memoryRead.current;
    if (!owner || offlineRef.current) return;
    setMemoryLoading(true);
    try {
      const { data, error } = await supabase.from('dante_memory').select('id,fact,created_at').eq('user_id', owner).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MEMORY_LIMIT);
      if (error) throw new Error('Memory unavailable');
      if (request !== memoryRead.current || workspaceOwner.current !== owner || offlineRef.current) return;
      const memory = recentMemory(data, MEMORY_LIMIT); memoryRef.current = memory;
      setState(s => ({ ...s, danteMemory: memory })); setMemoryError(null);
    } catch {
      if (request === memoryRead.current && workspaceOwner.current === owner) setMemoryError('Could not load saved facts. Try again after applying the latest database migration.');
    } finally { if (request === memoryRead.current) setMemoryLoading(false); }
  }, []);
  useEffect(() => {
    setMemoryError(null); setMemoryLoading(false);
    if (!user || isOffline) return;
    void refreshDanteMemory();
    const refresh = () => { void refreshDanteMemory(); };
    window.addEventListener('focus', refresh);
    return () => { ++memoryRead.current; window.removeEventListener('focus', refresh); };
  }, [user?.id, isOffline, refreshDanteMemory]);

  const rememberFact = async (rawFact: string): Promise<DanteMemory> => {
    const fact = validateMemoryFact(rawFact);
    const owner = user?.id;
    if (!owner || userRef.current?.id !== owner || offlineRef.current !== isOffline || workspaceOwner.current !== (isOffline ? null : owner)) throw new Error('Your account changed. Please try again.');
    let saved: DanteMemory;
    if (isOffline) {
      const existing = memoryRef.current.find(row => row.fact === fact);
      if (existing) return existing;
      if (memoryRef.current.length >= MEMORY_LIMIT) throw new Error('Dante can remember at most 100 facts. Forget a fact first.');
      saved = { id: newId(), fact, createdAt: new Date().toISOString() };
    } else {
      const { data, error } = await supabase.rpc('remember_dante_fact', { p_fact: fact, p_owner: owner });
      if (error) throw new Error(error.message?.includes('Dante memory limit reached') ? 'Dante can remember at most 100 facts. Forget a fact first.' : 'Could not save this fact. Please try again.');
      saved = memoryFromRow(data);
    }
    if (userRef.current?.id !== owner || offlineRef.current !== isOffline || workspaceOwner.current !== (isOffline ? null : owner)) throw new Error('Your account changed. Please try again.');
    ++memoryRead.current; setMemoryLoading(false);
    const memory = recentMemory([saved, ...memoryRef.current.filter(row => row.id !== saved.id)], MEMORY_LIMIT);
    memoryRef.current = memory;
    setState(s => ({ ...s, danteMemory: memory })); setMemoryError(null);
    if (isOffline) writeLS(LS.memory, memory);
    return saved;
  };
  const forgetFact = async (id: string) => {
    const owner = user?.id;
    if (typeof id !== 'string' || !id || id.length > 64) throw new Error('Invalid memory ID.');
    if (!owner || userRef.current?.id !== owner || offlineRef.current !== isOffline || workspaceOwner.current !== (isOffline ? null : owner)) throw new Error('Your account changed. Please try again.');
    if (!isOffline) {
      const { error } = await supabase.from('dante_memory').delete().eq('user_id', owner).eq('id', id);
      if (error) throw new Error('Could not forget this fact. Please try again.');
    }
    if (userRef.current?.id !== owner || offlineRef.current !== isOffline || workspaceOwner.current !== (isOffline ? null : owner)) return;
    ++memoryRead.current; setMemoryLoading(false);
    const memory = memoryRef.current.filter(row => row.id !== id); memoryRef.current = memory;
    setState(s => ({ ...s, danteMemory: memory })); setMemoryError(null);
    if (isOffline) writeLS(LS.memory, memory);
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
        ...lectures,
        ...semanticSearch,
        ...spaces,
        ...arena,
        ...gallery,
        ...challenges,
        focusSession: focus.focusSession,
        startTaskFocus: id => { const task = stateRef.current.tasks.find(t => t.id === id); if (task) focus.startFocus(task); },
        stopTaskFocus: focus.stopFocus,
        updateState,
        toggleTheme,
        toggleTaskDone,
        deleteTask,
        saveExamPlan,
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
        googleConnected,
        googleCalendarError: googleCalendarError || googleReadError,
        getGoogleAccessToken,
        disconnectGoogleCalendar,
        googleEvents,
        setGoogleEvents,
        loadingEvents,
        isLoadingData,
        syncError,
        loginWithGoogle,
        logOut,
        localImportOpen,
        localImportBusy,
        localImportError,
        importLocalWorkspace,
        declineLocalWorkspace,
        exportMyData,
        deleteMyAccount,
        fetchGoogleEvents,
        loginOffline,
        showBriefing,
        setShowBriefing,
        saveDanteMessage,
        clearDanteHistory,
        memoryLoading, memoryError, refreshDanteMemory, rememberFact, forgetFact, confirmForgetFact,
        ...taskNotifications,
        getAuthToken,
        danteUsage: usageState.userId === user?.id ? usageState.data : null,
        danteUsageError: usageState.userId === user?.id ? usageState.error : null,
        refreshDanteUsage,
        billing: billingState?.owner === (user?.id ?? null) ? billingState : null,
        refreshBilling,
        startBilling,
        liveOpen,
        setLiveOpen,
        passwordRecovery,
        setPasswordRecovery,
        stateRef,
      }}
    >
      {children}
      {memoryDialog}
    </ZenosContext.Provider>
  );
};

export const useZenos = () => {
  const ctx = useContext(ZenosContext);
  if (!ctx) throw new Error('useZenos must be used within ZenosProvider');
  return ctx;
};
