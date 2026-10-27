import { spaceText, SPACE_LIMITS } from '../../shared/space';
import { validateMemoryFact, type DanteMemory } from '../../shared/danteMemory';
import { isRecurrence } from './recurrence';
import { Task, Meeting, ZenosState } from '../types';
import { today } from './utils';
import { DanteAction } from './dante';

export type ActionResult = { label: string; ok: boolean; detail?: string };

export interface ActionDeps {
  stateRef: { current: ZenosState };
  editSpacePageFromVoice?: (instruction: string) => Promise<void>;
  rememberFact?: (fact: string) => Promise<DanteMemory>;
  forgetFact?: (id: string) => Promise<void>;
  confirmForgetFact?: (fact: DanteMemory) => Promise<boolean>;
  addTask: (t: Omit<Task, 'id'>) => Promise<Task | null>;
  editTask: (id: number | string, u: Partial<Task>) => Promise<void>;
  toggleTaskDone: (id: number | string) => Promise<void>;
  addMeeting: (m: Omit<Meeting, 'id' | 'createdAt'>) => Promise<Meeting | null>;
  updateState: (u: Partial<ZenosState>) => void;
}

const VIEWS = ["dashboard", "tasks", "kanban", "calendar", "meetings", "analytics", "vault", "dante", "lectures", "search", "space", "gallery", "focus_rooms"];

/** Runs the actions Dante asked for. Shared by the chat page and Dante Live. */
export async function runDanteActions(actions: DanteAction[], deps: ActionDeps): Promise<ActionResult[]> {
  const { stateRef, addTask, editTask, toggleTaskDone, addMeeting, updateState } = deps;
  const findTask = (data: any): Task | null => {
    const tasks = stateRef.current.tasks;
    if (data?.id != null) {
      const byId = tasks.find(t => String(t.id) === String(data.id));
      if (byId) return byId;
    }
    const title = String(data?.title || "").trim().toLowerCase();
    if (!title) return null; // an empty title used to match the first task
    const exact = tasks.filter(t => t.title.toLowerCase() === title);
    if (exact.length === 1) return exact[0];
    const partial = tasks.filter(t => t.title.toLowerCase().includes(title));
    return partial.length === 1 ? partial[0] : null;
  };

  const resolveCategory = (cat: unknown): string => {
    const cats = stateRef.current.categories;
    const c = String(cat || "").toLowerCase();
    const hit = cats.find(x => x.id.toLowerCase() === c) || cats.find(x => x.label.toLowerCase() === c);
    return hit?.id || cats.find(x => x.label.toLowerCase() === "other")?.id || cats[0]?.id || "other";
  };

  const validDate = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

  const executeAction = async (a: DanteAction): Promise<ActionResult> => {
    const d = a.data || {};
    switch (a.action) {
      case 'edit_space_page': {
        const instruction = spaceText(d.instruction, SPACE_LIMITS.prompt, 'page instruction');
        if (!deps.editSpacePageFromVoice) return {label: 'Update page', ok: false, detail: 'Open Dante Live on a My Space page to edit it.'};
        await deps.editSpacePageFromVoice(instruction);
        return {label: 'New page save point', ok: true};
      }
      case 'remember': {
        const fact = validateMemoryFact(d.fact);
        if (!deps.rememberFact) return { label: 'Remember fact', ok: false, detail: 'Memory is unavailable' };
        await deps.rememberFact(fact);
        return { label: 'Remember fact', ok: true };
      }
      case 'forget': {
        if (typeof d.id !== 'string' || !d.id || d.id.length > 64) return { label: 'Forget fact', ok: false, detail: 'Invalid memory ID' };
        const memory = stateRef.current.danteMemory?.find(row => row.id === d.id);
        if (!memory) return { label: 'Forget fact', ok: false, detail: 'No saved fact matches that ID' };
        if (!deps.forgetFact || !deps.confirmForgetFact) return { label: 'Forget fact', ok: false, detail: 'Confirmation is required' };
        if (!await deps.confirmForgetFact(memory)) return { label: 'Forget fact', ok: false, detail: 'Canceled' };
        await deps.forgetFact(memory.id);
        return { label: 'Forget fact', ok: true };
      }
      case "create_task": {
        if (d.repeat !== undefined && !isRecurrence(d.repeat)) return { label: 'Create task', ok: false, detail: 'Invalid repeat option' };
        if (!d.title) return { label: "Create task", ok: false, detail: "No title given" };
        const t = await addTask({
          title: String(d.title).slice(0, 200),
          cat: resolveCategory(d.cat),
          status: "todo",
          date: validDate(d.date) || today(),
          recurrence: d.repeat ?? "none",
          reminder: "",
          note: d.note ? String(d.note) : "",
          progress: 0,
          steps: [],
        });
        return { label: `Create task “${d.title}”`, ok: !!t, detail: t ? undefined : "Could not save" };
      }
      case "complete_task":
      case "reopen_task":
      case "toggle_task": {
        const t = findTask(d);
        if (!t) return { label: "Update task", ok: false, detail: `No single task matches “${d.title || d.id || ""}”` };
        const wantDone = a.action === "complete_task" ? true : a.action === "reopen_task" ? false : t.status !== "done";
        if ((t.status === "done") !== wantDone) await toggleTaskDone(t.id);
        return { label: `${wantDone ? "Complete" : "Reopen"} “${t.title}”`, ok: true };
      }
      case "update_task": {
        const t = findTask(d);
        if (!t) return { label: "Update task", ok: false, detail: `No single task matches “${d.title || d.id || ""}”` };
        if (d.repeat !== undefined && !isRecurrence(d.repeat)) return { label: 'Update task', ok: false, detail: 'Invalid repeat option' };
        const updates: Partial<Task> = {};
        if (d.repeat !== undefined) updates.recurrence = d.repeat;
        if (d.newTitle || (d.title && d.id)) updates.title = String(d.newTitle || d.title);
        if (validDate(d.date)) updates.date = d.date;
        if (["todo", "inprogress", "done"].includes(d.status)) updates.status = d.status;
        if (typeof d.note === "string") updates.note = d.note;
        if (d.cat) updates.cat = resolveCategory(d.cat);
        await editTask(t.id, updates);
        return { label: `Update “${t.title}”`, ok: true };
      }
      case "add_task_steps": {
        const t = findTask(d);
        if (!t) return { label: 'Break down task', ok: false, detail: 'No single task matches' };
        if (!Array.isArray(d.steps) || d.steps.length < 1 || d.steps.length > 10 || d.steps.some((label: unknown) => typeof label !== 'string' || !label.trim() || label.trim().length > 200)) {
          return { label: 'Break down task', ok: false, detail: 'Give 1–10 short, non-empty checklist steps' };
        }
        const existing = t.steps || [];
        const seen = new Set(existing.map(step => step.label.trim().toLowerCase()));
        const added = d.steps.map((label: string) => label.trim()).filter((label: string) => {
          const key = label.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
        }).map((label: string) => ({ label, done: false }));
        if (added.length) {
          const steps = [...existing, ...added];
          await editTask(t.id, { steps, progress: Math.round(steps.filter(step => step.done).length / steps.length * 100) });
        }
        return { label: `Add ${added.length} steps to “${t.title}”`, ok: true };
      }
      case "create_meeting": {
        const m = await addMeeting({
          personName: String(d.personName || "Team"),
          date: validDate(d.date) || today(),
          time: /^\d{1,2}:\d{2}$/.test(d.time || "") ? d.time.padStart(5, "0") : "10:00",
          subject: String(d.subject || "Meeting"),
          status: "upcoming",
          elapsedSeconds: 0,
          notes: "",
        });
        return { label: `Schedule “${d.subject || "Meeting"}”`, ok: !!m, detail: m ? undefined : "Could not save" };
      }
      case "switch_view": {
        if (!VIEWS.includes(d.view)) return { label: "Open view", ok: false, detail: `Unknown view “${d.view}”` };
        updateState({ view: d.view });
        return { label: `Open ${d.view}`, ok: true };
      }
      case "filter_category": {
        const cat = d.cat ? resolveCategory(d.cat) : null;
        updateState({ filterCat: cat, view: "tasks" });
        return { label: cat ? `Filter by ${stateRef.current.categories.find(c => c.id === cat)?.label}` : "Show all tasks", ok: true };
      }
      default:
        return { label: a.action, ok: false, detail: "Unknown action" };
    }
  };


  const results: ActionResult[] = [];
  for (const a of actions.slice(0, 10)) {
    try {
      results.push(await executeAction(a));
    } catch (e: any) {
      results.push({ label: a.action, ok: false, detail: e?.message });
    }
  }
  return results;
}
