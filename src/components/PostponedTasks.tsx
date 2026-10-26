import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { breakdownPrompt, postponedCount } from '../lib/postponement';
import { btn, card } from './ui/kit';
export default function PostponedTasks() {
  const { state, startTaskFocus } = useZenos();
  const navigate = useNavigate();
  const tasks = state.tasks.filter(task => task.status !== 'done' && postponedCount(task) >= 3);
  if (!tasks.length) return null;
  return <section aria-label="A small start" className="flex flex-col gap-3">
    {tasks.map(task => <article key={task.id} className={`${card} p-5 sm:p-6 border border-primary/20`}>
      <p className="text-xs font-medium text-primary mb-2">A small start is enough</p>
      <h2 className="text-lg font-semibold text-on-surface break-words">{task.title}</h2>
      <p className="text-sm text-on-surface-variant mt-2 leading-6">This moved {postponedCount(task)} times. Want to just do the first 5 minutes?</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={btn.secondary} onClick={() => navigate('/dante', { state: { prompt: breakdownPrompt(task) } })}>Break it down with Dante</button>
        <button className={btn.primary} onClick={() => startTaskFocus(task.id)}>Start 5-min focus</button>
      </div>
    </article>)}
  </section>;
}
