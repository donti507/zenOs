import type {AdventureSpec} from '../spec';
import {normalizeProgress,unlockedGates,type QuestProgress} from './quest';
export const XP_PER_LEVEL=50;
export function progression(spec:AdventureSpec,input:QuestProgress){
 const progress=normalizeProgress(spec,input),xp=spec.missions.filter(m=>progress.completed.includes(m.id)).reduce((sum,m)=>sum+m.xp,0);
 return {xp,level:1+Math.floor(xp/XP_PER_LEVEL),levelXp:xp%XP_PER_LEVEL,nextLevelXp:XP_PER_LEVEL,unlocked:unlockedGates(spec,progress),completed:progress.completed.length,total:spec.missions.length};
}
