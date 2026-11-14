import type {AdventureSpec} from '../spec';
import {VILLAGE,type Position} from '../templates/village';
import {canEnter} from './world';
import {missionForNpc,questStatus,type QuestProgress} from './quest';
export const INTERACTION_RADIUS=1.45;
export function placedNpcs(spec:AdventureSpec){return spec.npcs.map(npc=>({...npc,position:{...VILLAGE.npcSlots[npc.slot]}}));}
export function npcInRange(spec:AdventureSpec,player:Position,npcId:string,progress?:QuestProgress){const npc=placedNpcs(spec).find(n=>n.id===npcId);return !!npc&&(!progress||canEnter(spec,progress,npc.position))&&Number.isFinite(player.x)&&Number.isFinite(player.y)&&Math.hypot(player.x-npc.position.x,player.y-npc.position.y)<=INTERACTION_RADIUS;}
export function nearbyNpc(spec:AdventureSpec,player:Position,progress?:QuestProgress){return placedNpcs(spec).filter(npc=>npcInRange(spec,player,npc.id,progress)).sort((a,b)=>Math.hypot(player.x-a.position.x,player.y-a.position.y)-Math.hypot(player.x-b.position.x,player.y-b.position.y))[0]??null;}
export function npcMarker(spec:AdventureSpec,progress:QuestProgress,npcId:string){
 if(!spec.missions.some(m=>m.npcId===npcId))return 'none';const mission=missionForNpc(spec,progress,npcId);if(!mission)return 'done';const status=questStatus(spec,progress,mission.id);return status==='active'?'active':status==='available'?'available':'locked';
}
