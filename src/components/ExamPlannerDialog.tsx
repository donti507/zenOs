import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useZenos } from '../context/ZenosContext';
import { planExam, remainingExamTasks, type ExamDraft } from '../lib/examPlanner';
import { today } from '../lib/utils';
import { Modal, Field, input, textarea, btn } from './ui/kit';
export default function ExamPlannerDialog({ planId, onClose }: { planId?: string; onClose: () => void }) {
  const { state, googleEvents, saveExamPlan } = useZenos();
  const [expected] = useState(() => planId ? remainingExamTasks(state.tasks, planId) : undefined);
  const existing = expected?.[0]?.examPlan;
  const id = useRef(planId || crypto.randomUUID());
  const [name, setName] = useState(existing?.name || '');
  const [date, setDate] = useState(existing?.examDate || '');
  const [minutes, setMinutes] = useState(existing?.minutesPerDay || 50);
  const [topics, setTopics] = useState(expected?.map(t => t.steps?.find(s => s.id === t.examPlan?.topicId)?.label || t.title).join('\n') || '');
  const [preview, setPreview] = useState<ExamDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const linked = new Set((state.meetings || []).map(m => m.googleEventId).filter(Boolean));
  const meetingDates = [...(state.meetings || []).map(m => m.date), ...googleEvents.filter((e: any) => !linked.has(e.id)).map((e: any) => (e.start?.date || e.start?.dateTime || '').slice(0,10))];
  let sessions: ReturnType<typeof planExam> = [];
  let previewError = '';
  if (preview) { try { sessions = planExam(preview, today(), meetingDates); } catch (e) { previewError = (e as Error).message; } }
  function review() {
    try {
      const draft: ExamDraft = { id: id.current, name, examDate: date, minutesPerDay: minutes, topics: topics.split('\n').map(t => t.trim()).filter(Boolean).map((title,i) => ({ id: expected?.[i]?.examPlan?.topicId || crypto.randomUUID(), title })) };
      planExam(draft, today(), meetingDates); setPreview(draft); setError('');
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    if (!preview || saving) return;
    setSaving(true); setError('');
    try { await saveExamPlan(preview, expected); onClose(); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  }
  return createPortal(<Modal open title={planId ? 'Re-plan study sessions' : 'Exam planner'} onClose={() => { if (!saving) onClose(); }} width={560}
    footer={<><button className={btn.ghost} disabled={saving} onClick={() => preview ? setPreview(null) : onClose()}>{preview ? 'Back' : 'Cancel'}</button><button className={btn.primary} disabled={saving || !!previewError} onClick={preview ? save : review}>{saving ? 'Saving…' : preview ? (planId ? 'Update sessions' : 'Create study tasks') : 'Review sessions'}</button></>}>
    <div className="flex flex-col gap-4">
      <p className="text-sm text-on-surface-variant">{planId ? 'Move unfinished topics only. Completed tasks and checked topic steps stay untouched.' : 'One topic per study task, with a checklist step. Sessions use up to 25 minutes each, within your daily budget.'} Study days run backwards from the day before your exam; days with two or more meetings are skipped.</p>
      {!preview ? <>
        <Field label="Exam name"><input className={input} maxLength={160} value={name} onChange={e => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><Field label="Exam date"><input type="date" className={input} min={today()} value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Minutes per day"><input type="number" min={1} max={1440} className={input} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></Field></div>
        <Field label="Topics (one per line)" hint={planId ? 'Remaining topics are kept with their existing tasks.' : 'Up to 100 topics.'}><textarea className={textarea} rows={6} readOnly={!!planId} value={topics} onChange={e => setTopics(e.target.value)} /></Field>
      </> : <><p className="font-medium">{sessions.length} study tasks · {preview.name} · Exams category</p><ul className="divide-y divide-outline-variant">{sessions.map(s => <li key={s.topicId} className="py-2 flex flex-wrap justify-between gap-2"><span className="break-words min-w-0">{s.topic}</span><span className="text-sm text-on-surface-variant">{s.date} · {s.minutes} min</span></li>)}</ul></>}
      {(error || previewError) && <p role="alert" className="text-error text-sm">{error || previewError}</p>}
    </div>
  </Modal>, document.body);
}
