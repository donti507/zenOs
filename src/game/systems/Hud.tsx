import type {AdventureSpec} from '../spec';
import {currentMission,finaleComplete,type QuestProgress} from './quest';
import {progression} from './progression';
import {tr,useUiLanguage} from '../../i18n';
import {card} from '../../components/ui/kit';
export default function Hud({spec,progress}:{spec:AdventureSpec;progress:QuestProgress}){
 useUiLanguage();const stats=progression(spec,progress),mission=currentMission(spec,progress),objective=spec.objectives.find(o=>o.id===mission?.objectiveId);
 return <section aria-label={tr('Adventure progress')} className={card+' p-3 space-y-2 ring-1 ring-outline-variant'}><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">{tr('Level {{0}}',stats.level)} · {tr('{{0}} preview XP',stats.xp)}</span><span className="text-on-surface-variant">{tr('{{0}} of {{1}} missions',stats.completed,stats.total)}</span></div><div role="progressbar" aria-label={tr('XP towards next level')} aria-valuemin={0} aria-valuemax={stats.nextLevelXp} aria-valuenow={stats.levelXp} className="h-1.5 rounded-full overflow-hidden bg-surface-container-high"><div className="h-full bg-primary" style={{width:`${stats.levelXp/stats.nextLevelXp*100}%`}}/></div><p className="text-sm font-medium">{mission?mission.title:tr('Adventure complete')}</p>{objective&&<p className="text-xs text-on-surface-variant">{objective.text}</p>}{finaleComplete(spec,progress)&&<p className="text-sm text-on-surface-variant">{spec.finale.text}</p>}</section>;
}
