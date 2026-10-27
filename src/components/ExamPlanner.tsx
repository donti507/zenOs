import { lazy, Suspense, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import { remainingExamTasks, type ExamPlan } from '../lib/examPlanner';
import { today } from '../lib/utils';
import { btn } from './ui/kit';
const ExamPlannerDialog = lazy(() => import('./ExamPlannerDialog'));
export default function ExamPlanner() {
  const { state, user } = useZenos();
  const [open, setOpen] = useState<string | null>(null);
  const plans = [...new Map<string, ExamPlan>(state.tasks.filter(t => t.examPlan).map(t => [t.examPlan!.id, t.examPlan!] as const)).values()];
  const overdue = plans.filter(p => remainingExamTasks(state.tasks, p.id).some(t => t.date < today()));
  return <>
    <button className={btn.secondary} onClick={() => setOpen('new')}>Exam planner</button>
    {overdue.map(p => <button key={p.id} className={`${btn.secondary} max-w-full min-w-0`} onClick={() => setOpen(p.id)}><span className="break-all">Re-plan: {p.name}</span></button>)}
    {open && <Suspense fallback={<span role="status">Opening planner…</span>}><ExamPlannerDialog key={`${user?.id}:${open}`} planId={open === 'new' ? undefined : open} onClose={() => setOpen(null)} /></Suspense>}
  </>;
}
