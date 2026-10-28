import {tr,useUiLanguage} from '../i18n';
import { useZenos } from '../context/ZenosContext';
import { btn, card } from './ui/kit';
export default function TaskNotificationPrompt() {
  useUiLanguage();
  const { state, canAskNotifications, enableTaskNotifications, dismissTaskNotifications } = useZenos();
  if (!canAskNotifications || !state.tasks.some(task => task.status !== 'done' && task.reminder)) return null;
  return <aside aria-label={tr("Task reminders")} className={`${card} mx-4 mt-4 p-4 flex flex-wrap items-center gap-3 border border-outline-variant`}>
    <p className="text-sm text-on-surface flex-1 min-w-48">{tr("Get task reminder notifications while ZEN OS is open.")}</p>
    <button className={btn.secondary} onClick={dismissTaskNotifications}>{tr("Not now")}</button>
    <button className={btn.primary} onClick={enableTaskNotifications}>{tr("Enable notifications")}</button>
  </aside>;
}
