import type { Recurrence } from './lib/recurrence';
export interface Task {
  id: number | string;
  title: string;
  cat: string;
  status: 'todo' | 'inprogress' | 'done';
  date: string;
  reminder: string;
  note: string;
  progress: number;
  steps?: { id?: string; label: string; done: boolean }[];
  examPlan?: import('./lib/examPlanner').ExamPlan;
  completedAt?: string | null;
  postponedCount?: number;
  recurrence?: Recurrence;
  recurrenceSourceId?: string | null;
  recurrenceDay?: number | null;
}

export interface Category {
  id: string;
  label: string;
  color: string;
}

export interface SpecialTask {
  id: string;
  title: string;
  cat: string;
  deadline: string;
  steps: { label: string; done: boolean }[];
}

export interface VaultItem {
  id: string;
  type: 'file' | 'link';
  name: string;
  detail: string;
  url?: string;
  fileType?: string;
  size?: number;
  data?: string;
  addedAt: string;
}

export interface Meeting {
  id: string;
  personName: string;
  date: string;
  time: string;
  subject: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  elapsedSeconds?: number;
  notes?: string;
  googleEventId?: string | null;
  createdAt: string;
}

export interface ZenosState {
  workspaceId?: string | null;
  workspaceEpoch?:number;
  lectures?: import('../shared/lectures').Lecture[];
  danteMemory?: import('../shared/danteMemory').DanteMemory[];
  view: string;
  calYear: number;
  calMonth: number;
  theme: 'dark' | 'light';
  tasks: Task[];
  categories: Category[];
  specialTasks: SpecialTask[];
  vault: VaultItem[];
  danteHistory: DanteMessage[];
  completionLog: string[];
  filterCat: string | null;
  selectedDate?: string | null;
  meetings?: Meeting[];
  instantMeetEvent?: any | null;
}


export interface DanteMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}
