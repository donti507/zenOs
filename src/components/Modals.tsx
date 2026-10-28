import {tr,useUiLanguage,uiLocale} from '../i18n';
import { RECURRENCES } from '../lib/recurrence';
import { useEffect, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import { createGoogleCalendarEvent } from '../lib/googleCalendar';
import { today } from '../lib/utils';
import { Task } from '../types';
import { Modal, Field, Icon, btn, input, textarea } from './ui/kit';

type TaskForm = Omit<Task, 'id'>;
const emptyTask = (cat: string, date: string): TaskForm => ({
  title: '', cat, status: 'todo', recurrence: 'none', date, reminder: '', note: '', progress: 0, steps: [],
});

const PALETTE = ['#5b5fef', '#3b82f6', '#a855f7', '#f97316', '#10b981', '#ef4444', '#eab308', '#64748b'];
const meetUrlOf = (ev: any) => ev?.hangoutLink || ev?.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || '';

function MeetLink({ url }: { url: string }) {
  useUiLanguage();
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input readOnly value={url} className={`${input} font-code text-[12px]`} aria-label={tr("Meeting link")} />
        <button className={btn.secondary} onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Icon name={copied ? 'check' : 'content_copy'} className="text-[18px]" />{copied ? tr("Copied") : tr("Copy")}
        </button>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className={`${btn.solid} w-full h-11`}>
        <Icon name="video_call" className="text-[20px]" />{tr("Join now")}</a>
    </div>
  );
}

export default function Modals() {
  useUiLanguage();
  const {
    state, showModal, setShowModal, editTaskId, setEditTaskId, addTask, editTask, deleteTask,
    addCategory, updateState, addMeeting, fetchGoogleEvents, googleConnected, getGoogleAccessToken, canAskNotifications, enableTaskNotifications, notificationPermission,
  } = useZenos();

  const close = () => {
    setShowModal(null);
    setEditTaskId(null);
    if (state.selectedDate) updateState({ selectedDate: null });
  };

  // ---------- task ----------
  const [task, setTask] = useState<TaskForm>(emptyTask('other', ''));
  const [newStep, setNewStep] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Initialise the form only when a modal opens (not on every task change)
  useEffect(() => {
    setConfirmDelete(false);
    setNewStep('');
    if (showModal === 'editTask' && editTaskId != null) {
      const t = state.tasks.find(x => x.id === editTaskId);
      if (t) setTask({ ...t, steps: t.steps || [] });
    } else if (showModal === 'addTask') {
      setTask(emptyTask(state.filterCat || state.categories[0]?.id || 'other', state.selectedDate || ''));
    }
  }, [showModal, editTaskId]);

  const saveTask = async () => {
    if (!task.title.trim()) return;
    if (task.reminder && task.status !== 'done' && canAskNotifications) void enableTaskNotifications();
    const doneSteps = (task.steps || []).filter(s => s.done).length;
    const data = { ...task, title: task.title.trim() };
    // Progress follows the checklist when there is one
    if (task.steps?.length) data.progress = Math.round((doneSteps / task.steps.length) * 100);
    if (showModal === 'addTask') await addTask(data);
    else if (editTaskId != null) {
      const { completedAt, ...rest } = data;
      await editTask(editTaskId, rest);
    }
    close();
  };

  const removeTask = async () => {
    if (editTaskId == null) return;
    if (!confirmDelete) return setConfirmDelete(true);
    await deleteTask(editTaskId);
    close();
  };

  // ---------- category ----------
  const [cat, setCat] = useState({ label: '', color: PALETTE[0] });
  useEffect(() => { if (showModal === 'addCategory') setCat({ label: '', color: PALETTE[0] }); }, [showModal]);
  const saveCategory = async () => {
    if (!cat.label.trim()) return;
    await addCategory(cat.label.trim(), cat.color);
    close();
  };

  // ---------- Google meeting ----------
  const [meet, setMeet] = useState({ title: '', date: '', startTime: '10:00', endTime: '11:00', guests: '', description: '', addMeet: true });
  const [scheduling, setScheduling] = useState(false);
  const [meetError, setMeetError] = useState('');
  const [created, setCreated] = useState<any | null>(null);
  useEffect(() => {
    if (showModal === 'scheduleMeeting') {
      setMeet({ title: '', date: state.selectedDate || today(), startTime: '10:00', endTime: '11:00', guests: '', description: '', addMeet: true });
      setCreated(null);
      setMeetError('');
    }
  }, [showModal]);

  const scheduleMeeting = async () => {
    if (!meet.title.trim() || !meet.date) return setMeetError('Add a title and a date.');
    if (meet.endTime <= meet.startTime) return setMeetError('The end time must be after the start time.');
    if (!googleConnected) return setMeetError('Connect Google Calendar first (sign in with Google).');
    setScheduling(true);
    setMeetError('');
    try {
      const ev = await createGoogleCalendarEvent(getGoogleAccessToken, {
        summary: meet.title.trim(),
        description: meet.description,
        date: meet.date,
        startTime: meet.startTime,
        endTime: meet.endTime,
        guestEmails: meet.guests.split(',').map(e => e.trim()).filter(Boolean),
        addMeetLink: meet.addMeet,
      });
      await fetchGoogleEvents();
      const link = meetUrlOf(ev);
      await addMeeting({
        personName: meet.guests.split(',')[0]?.trim() || 'Team',
        date: meet.date,
        time: meet.startTime,
        subject: meet.title.trim(),
        status: 'upcoming',
        elapsedSeconds: 0,
        notes: [meet.description, link && `Meet url: ${link}`].filter(Boolean).join('\n'),
        googleEventId: ev.id || null,
      });
      setCreated(ev);
    } catch (err: any) {
      setMeetError(err?.message || 'Google Calendar rejected the request.');
    } finally {
      setScheduling(false);
    }
  };

  const steps = task.steps || [];

  return (
    <>
      {/* Add / edit task */}
      <Modal
        open={showModal === 'addTask' || showModal === 'editTask'}
        onClose={close}
        title={showModal === 'addTask' ? tr("New task") : tr("Edit task")}
        width={520}
        footer={
          <>
            {showModal === 'editTask' && (
              <button className={`${confirmDelete ? btn.danger : btn.ghost} mr-auto`} onClick={removeTask}>
                <Icon name="delete" className="text-[18px]" />{confirmDelete ? tr("Click again to delete") : tr("Delete")}
              </button>
            )}
            <button className={btn.ghost} onClick={close}>{tr("Cancel")}</button>
            <button className={btn.solid} onClick={saveTask} disabled={!task.title.trim()}>
              {showModal === 'addTask' ? tr("Add task") : tr("Save changes")}
            </button>
          </>
        }
      >
        <Field label={tr("Title")}>
          <input className={input} value={task.title} placeholder={tr("What needs doing?")} onChange={e => setTask({ ...task, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveTask()} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tr("Category")}>
            <select className={input} value={task.cat} onChange={e => setTask({ ...task, cat: e.target.value })}>
              {state.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label={tr("Status")}>
            <select className={input} value={task.status} onChange={e => setTask({ ...task, status: e.target.value as Task['status'] })}>
              <option value="todo">{tr("To do")}</option>
              <option value="inprogress">{tr("In progress")}</option>
              <option value="done">{tr("Done")}</option>
            </select>
          </Field>
          <Field label={tr("Due date")}>
            <input type="date" className={input} value={task.date} onChange={e => setTask({ ...task, date: e.target.value })} />
          </Field>
          <Field label={tr("Repeat")}>
            <select className={input} value={task.recurrence || 'none'} onChange={e => setTask({ ...task, recurrence: e.target.value as Task['recurrence'], date: task.date || today() })}>
              {RECURRENCES.map(rule => <option key={rule} value={rule}>{rule === 'none' ? tr("None") : tr(rule[0].toUpperCase() + rule.slice(1))}</option>)}
            </select>
          </Field>
          <Field label={tr("Reminder")}>
            <input type="datetime-local" className={input} value={task.reminder} onChange={e => setTask({ ...task, reminder: e.target.value })} />
          </Field>
        </div>

        {task.reminder && <p className="text-xs text-on-surface-variant">{tr("Reminders use your local time and work while the app is open. ")}{notificationPermission === 'denied' ? tr("Notifications are blocked; change your browser’s site settings to enable them.") : notificationPermission === 'unsupported' ? tr("This browser does not support task notifications.") : canAskNotifications ? tr("Saving this reminder will ask for notification permission once.") : notificationPermission === 'granted' ? tr("Browser notifications are enabled.") : tr("You can enable notifications in your browser’s site settings.")}
        </p>}
        <Field label={tr("Checklist{{0}}",steps.length ? ` · ${steps.filter(s => s.done).length}/${steps.length}` : '')}>
          <div className="flex flex-col gap-1">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={() => setTask({ ...task, steps: steps.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })}
                  className="w-4 h-4 accent-[var(--z-primary)]"
                  aria-label={tr("Step: {{0}}",s.label)}
                />
                <span className={`flex-1 ${s.done ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>{s.label}</span>
                <button className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-on-surface-variant hover:text-error cursor-pointer" onClick={() => setTask({ ...task, steps: steps.filter((_, j) => j !== i) })} aria-label={tr("Remove step {{0}}",s.label)}>
                  <Icon name="close" className="text-[16px]" />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <input
                className={input}
                placeholder={tr("Add a step and press Enter")}
                value={newStep}
                onChange={e => setNewStep(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newStep.trim()) {
                    e.preventDefault();
                    setTask({ ...task, steps: [...steps, { label: newStep.trim(), done: false }] });
                    setNewStep('');
                  }
                }}
              />
            </div>
          </div>
        </Field>

        {!steps.length && (
          <Field label={tr("Progress · {{0}}%",task.progress)}>
            <input type="range" min={0} max={100} step={5} className="w-full accent-[var(--z-primary)]" value={task.progress} onChange={e => setTask({ ...task, progress: Number(e.target.value) })} />
          </Field>
        )}
        <Field label={tr("Notes")}>
          <textarea className={textarea} value={task.note} placeholder={tr("Details, links, context for Dante…")} onChange={e => setTask({ ...task, note: e.target.value })} />
        </Field>
      </Modal>

      {/* New category */}
      <Modal
        open={showModal === 'addCategory'}
        onClose={close}
        title={tr("New category")}
        width={400}
        footer={<><button className={btn.ghost} onClick={close}>{tr("Cancel")}</button><button className={btn.solid} onClick={saveCategory} disabled={!cat.label.trim()}>{tr("Add category")}</button></>}
      >
        <Field label={tr("Name")}>
          <input className={input} value={cat.label} placeholder={tr("e.g. Thesis")} onChange={e => setCat({ ...cat, label: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveCategory()} />
        </Field>
        <Field label={tr("Colour")}>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map(c => (
              <button key={c} onClick={() => setCat({ ...cat, color: c })} aria-label={tr("Colour {{0}}",c)} aria-pressed={cat.color === c}
                className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${cat.color === c ? 'ring-2 ring-offset-2 ring-offset-surface-container-lowest ring-on-surface scale-110' : ''}`}
                style={{ background: c }} />
            ))}
          </div>
        </Field>
      </Modal>

      {/* Schedule Google meeting */}
      <Modal
        open={showModal === 'scheduleMeeting'}
        onClose={close}
        title={created ? tr("Meeting scheduled") : tr("Schedule a Google meeting")}
        width={520}
        footer={
          created ? (
            <button className={btn.secondary} onClick={close}>{tr("Done")}</button>
          ) : (
            <>
              <button className={btn.ghost} onClick={close}>{tr("Cancel")}</button>
              <button className={btn.solid} onClick={scheduleMeeting} disabled={scheduling}>
                {scheduling ? tr("Scheduling…") : tr("Schedule")}
              </button>
            </>
          )
        }
      >
        {created ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-success-container">
              <Icon name="event_available" className="text-[24px] text-success" />
              <div>
                <div className="font-semibold text-on-surface">{created.summary}</div>
                <div className="text-[12px] text-on-surface-variant">
                  {created.start?.dateTime ? new Date(created.start.dateTime).toLocaleString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : created.start?.date}
                </div>
              </div>
            </div>
            <MeetLink url={meetUrlOf(created)} />
          </div>
        ) : (
          <>
            {!googleConnected && (
              <div className="p-3 rounded-lg bg-warning-container text-on-surface text-[13px] flex gap-2">
                <Icon name="info" className="text-[18px] text-warning" />{tr("Sign in with Google to create calendar events with a Meet link.")}</div>
            )}
            <Field label={tr("Title")}>
              <input className={input} value={meet.title} placeholder={tr("e.g. Sync on Chapter 4")} onChange={e => setMeet({ ...meet, title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={tr("Date")}><input type="date" className={input} value={meet.date} onChange={e => setMeet({ ...meet, date: e.target.value })} /></Field>
              <Field label={tr("Start")}><input type="time" className={input} value={meet.startTime} onChange={e => setMeet({ ...meet, startTime: e.target.value })} /></Field>
              <Field label={tr("End")}><input type="time" className={input} value={meet.endTime} onChange={e => setMeet({ ...meet, endTime: e.target.value })} /></Field>
            </div>
            <Field label={tr("Guests")} hint={tr("Comma-separated email addresses")}>
              <input className={input} value={meet.guests} placeholder={tr("anna@uni.edu, prof@uni.edu")} onChange={e => setMeet({ ...meet, guests: e.target.value })} />
            </Field>
            <Field label={tr("Agenda")}>
              <textarea className={textarea} value={meet.description} onChange={e => setMeet({ ...meet, description: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[var(--z-primary)]" checked={meet.addMeet} onChange={e => setMeet({ ...meet, addMeet: e.target.checked })} />{tr("Add a Google Meet video link")}</label>
            {meetError && <div className="text-[13px] text-error" role="alert">{tr(meetError)}</div>}
          </>
        )}
      </Modal>

      {/* Instant meeting created */}
      <Modal open={showModal === 'instantMeetSuccess' && !!state.instantMeetEvent} onClose={() => { close(); updateState({ instantMeetEvent: null }); }} title={tr("Instant meeting ready")} width={460}>
        <p className="text-on-surface-variant">{tr("A one-hour meeting was added to your Google Calendar. Share the link with anyone who should join.")}</p>
        <MeetLink url={meetUrlOf(state.instantMeetEvent)} />
      </Modal>
    </>
  );
}
