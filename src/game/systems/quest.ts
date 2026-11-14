import type {AdventureSpec} from '../spec';
export type QuestProgress={accepted:string[];completed:string[]};
export type QuestStatus='locked'|'available'|'active'|'completed';
export const emptyProgress=():QuestProgress=>({accepted:[],completed:[]});
/** Rebuild progress from known IDs and prerequisite closure; ignore forged XP/unlock fields. */
export function normalizeProgress(spec:AdventureSpec,input:unknown):QuestProgress{
 const raw=input as Partial<QuestProgress>|null;
 const wanted=new Set(Array.isArray(raw?.completed)?raw.completed.filter(v=>typeof v==='string').slice(0,8):[]),completed=new Set<string>();
 for(let pass=0;pass<spec.missions.length;pass++)for(const m of spec.missions)if(wanted.has(m.id)&&m.prerequisites.every(id=>completed.has(id)))completed.add(m.id);
 const accepted=new Set(Array.isArray(raw?.accepted)?raw.accepted.filter(v=>typeof v==='string').slice(0,8):[]);
 return {completed:spec.missions.filter(m=>completed.has(m.id)).map(m=>m.id),accepted:spec.missions.filter(m=>accepted.has(m.id)&&!completed.has(m.id)&&m.prerequisites.every(id=>completed.has(id))).map(m=>m.id)};
}
export function questStatus(spec:AdventureSpec,progress:QuestProgress,id:string):QuestStatus{
 progress=normalizeProgress(spec,progress);const mission=spec.missions.find(m=>m.id===id);if(!mission)return 'locked';
 if(progress.completed.includes(id))return 'completed';
 if(!mission.prerequisites.every(ref=>progress.completed.includes(ref)))return 'locked';
 return progress.accepted.includes(id)?'active':'available';
}
export function unlockedGates(spec:AdventureSpec,progress:QuestProgress):string[]{progress=normalizeProgress(spec,progress);return [...new Set(spec.missions.filter(m=>progress.completed.includes(m.id)&&m.unlocks).map(m=>m.unlocks!.gateSlot))];}
export function currentMission(spec:AdventureSpec,progress:QuestProgress){return spec.missions.find(m=>questStatus(spec,progress,m.id)==='active')??spec.missions.find(m=>questStatus(spec,progress,m.id)==='available')??null;}
export function missionForNpc(spec:AdventureSpec,progress:QuestProgress,npcId:string){
 const missions=spec.missions.filter(m=>m.npcId===npcId);
 return missions.find(m=>questStatus(spec,progress,m.id)==='active')??missions.find(m=>questStatus(spec,progress,m.id)==='available')??missions.find(m=>questStatus(spec,progress,m.id)==='locked')??null;
}
export function objectiveComplete(spec:AdventureSpec,progress:QuestProgress,objectiveId:string){progress=normalizeProgress(spec,progress);const missions=spec.missions.filter(m=>m.objectiveId===objectiveId);return missions.length>0&&missions.every(m=>progress.completed.includes(m.id));}
export function finaleComplete(spec:AdventureSpec,progress:QuestProgress){progress=normalizeProgress(spec,progress);return spec.finale.missionIds.every(id=>progress.completed.includes(id));}
/** Completion is a local preview transition; a future server verifier must authorize real completion. */
export function transitionQuest(spec:AdventureSpec,input:unknown,action:{type:'accept'|'complete';missionId:string}){
 const progress=normalizeProgress(spec,input),status=questStatus(spec,progress,action.missionId),before=unlockedGates(spec,progress);
 const mission=spec.missions.find(m=>m.id===action.missionId);let xpGranted=0;
 if(mission&&action.type==='accept'&&status==='available')progress.accepted.push(mission.id);
 if(mission&&action.type==='complete'&&status==='active'){
  progress.completed.push(mission.id);progress.accepted=progress.accepted.filter(id=>id!==mission.id);xpGranted=mission.xp;
 }
 return {progress:normalizeProgress(spec,progress),xpGranted,missionId:xpGranted?mission!.id:null,newlyUnlocked:unlockedGates(spec,progress).filter(id=>!before.includes(id))};
}
