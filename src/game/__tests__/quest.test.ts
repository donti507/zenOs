import {it,expect} from 'vitest';
import {lostBinaryKingdom as spec} from '../samples/lost-binary-kingdom';
import {emptyProgress,normalizeProgress,questStatus,transitionQuest,unlockedGates,objectiveComplete,finaleComplete,currentMission,missionForNpc} from '../systems/quest';
import {progression} from '../systems/progression';
import {nearbyNpc,npcInRange,npcMarker,placedNpcs,INTERACTION_RADIUS} from '../systems/npc';
import {npcDialogue,dialogueIndex} from '../systems/dialogue';
import {canEnter,activeGates} from '../systems/world';
import {movePlayer} from '../systems/movement';
const finish=(p:any,id:string)=>transitionQuest(spec,transitionQuest(spec,p,{type:'accept',missionId:id}).progress,{type:'complete',missionId:id});
it('derives initial availability, current mission, objectives and NPC markers from the spec',()=>{
 const p=emptyProgress();expect(questStatus(spec,p,'power-path')).toBe('available');expect(questStatus(spec,p,'east-gate')).toBe('locked');expect(currentMission(spec,p)?.id).toBe('power-path');expect(missionForNpc(spec,p,'ada')?.id).toBe('circuit-archive');expect(npcMarker(spec,p,'byte')).toBe('available');expect(npcMarker(spec,p,'ada')).toBe('locked');expect(objectiveComplete(spec,p,'powers')).toBe(false);expect(finaleComplete(spec,p)).toBe(false);
});
it('requires acceptance and prerequisites, ignores unknown missions and grants XP only once',()=>{
 let p=emptyProgress();for(const id of ['power-path','east-gate','missing'])expect(transitionQuest(spec,p,{type:'complete',missionId:id}).xpGranted).toBe(0);
 expect(transitionQuest(spec,p,{type:'accept',missionId:'circuit-archive'}).progress).toEqual(p);
 p=transitionQuest(spec,p,{type:'accept',missionId:'power-path'}).progress;expect(questStatus(spec,p,'power-path')).toBe('active');expect(npcMarker(spec,p,'byte')).toBe('active');const done=transitionQuest(spec,p,{type:'complete',missionId:'power-path'});expect(done.xpGranted).toBe(20);expect(done.newlyUnlocked).toEqual(['archive-gate']);expect(transitionQuest(spec,done.progress,{type:'complete',missionId:'power-path'}).xpGranted).toBe(0);expect(questStatus(spec,done.progress,'east-gate')).toBe('available');
});
it('derives levels, XP bars, areas and the finale without trusting client counters',()=>{
 let p=finish(emptyProgress(),'power-path').progress;expect(progression(spec,p)).toMatchObject({xp:20,level:1,levelXp:20});expect(objectiveComplete(spec,p,'powers')).toBe(true);
 p=finish(p,'east-gate').progress;expect(progression(spec,p)).toMatchObject({xp:50,level:2,levelXp:0});p=finish(p,'circuit-archive').progress;expect(progression(spec,p)).toMatchObject({xp:90,level:2,levelXp:40,completed:3});expect(unlockedGates(spec,p)).toHaveLength(3);expect(finaleComplete(spec,p)).toBe(true);expect(currentMission(spec,p)).toBe(null);expect(npcMarker(spec,p,'ada')).toBe('done');
});
it('sanitizes untrusted progress, rejects orphan completions and handles unordered valid prerequisites',()=>{
 const dirty:any={completed:['east-gate','circuit-archive','missing'],accepted:['circuit-archive','missing'],xp:999999,unlocked:['east-gate']};expect(normalizeProgress(spec,dirty)).toEqual(emptyProgress());expect(unlockedGates(spec,dirty)).toEqual([]);expect(progression(spec,dirty).xp).toBe(0);expect(questStatus(spec,dirty,'circuit-archive')).toBe('locked');
 expect(normalizeProgress(spec,{completed:['circuit-archive','east-gate','power-path','power-path'],accepted:[]})).toEqual({completed:['power-path','east-gate','circuit-archive'],accepted:[]});
});
it('handles branching prerequisites independent of mission array order',()=>{
 const s=structuredClone(spec);s.missions[1].prerequisites=[];s.missions[2].prerequisites=['power-path','east-gate'];s.missions.reverse();let p=transitionQuest(s,emptyProgress(),{type:'accept',missionId:'power-path'}).progress;p=transitionQuest(s,p,{type:'complete',missionId:'power-path'}).progress;expect(questStatus(s,p,'circuit-archive')).toBe('locked');p=transitionQuest(s,p,{type:'accept',missionId:'east-gate'}).progress;p=transitionQuest(s,p,{type:'complete',missionId:'east-gate'}).progress;expect(questStatus(s,p,'circuit-archive')).toBe('available');
});
it('places only spec NPCs at approved slots and enforces interaction distance for any input method',()=>{
 expect(placedNpcs(spec).map(n=>n.position)).toEqual([{x:7,y:6},{x:4,y:7}]);expect(nearbyNpc(spec,{x:7,y:9})).toBe(null);expect(nearbyNpc(spec,{x:7,y:7})?.id).toBe('byte');expect(npcInRange(spec,{x:7+INTERACTION_RADIUS,y:6},'byte')).toBe(true);expect(npcInRange(spec,{x:9,y:6},'byte')).toBe(false);expect(npcInRange(spec,{x:NaN,y:6},'byte')).toBe(false);expect(npcInRange(spec,{x:7,y:6},'missing')).toBe(false);
});
it('opens real collision regions only after their unlocking mission completes',()=>{
 const point={x:11,y:7};expect(activeGates(spec)).toHaveLength(3);expect(canEnter(spec,emptyProgress(),point)).toBe(false);let p=finish(emptyProgress(),'power-path').progress;expect(canEnter(spec,p,point)).toBe(false);p=finish(p,'east-gate').progress;expect(canEnter(spec,p,point)).toBe(true);expect(canEnter(spec,p,{x:0,y:7})).toBe(false);
 let position={x:9,y:7};for(let i=0;i<100;i++){position=movePlayer(position,{x:1,y:0},16,p=>canEnter(spec,emptyProgress(),p));expect(canEnter(spec,emptyProgress(),position)).toBe(true);}
});
it('resolves dialogue speakers and bounds keyboard line navigation',()=>{
 const lines=npcDialogue(spec,'byte');expect(lines).toHaveLength(3);expect(lines[0].speakerName).toBe('Professor Byte');expect(lines[1].speakerName).toBe(null);expect(npcDialogue(spec,'missing')).toEqual([]);expect(dialogueIndex(0,3,-1)).toBe(0);expect(dialogueIndex(2,3,1)).toBe(2);
});
it('cannot talk through a locked area boundary to skip its unlock',()=>{
 const s=structuredClone(spec);s.npcs[1].slot='observatory';const player={x:9,y:7};expect(npcInRange(s,player,'ada')).toBe(true);expect(npcInRange(s,player,'ada',emptyProgress())).toBe(false);const p=finish(finish(emptyProgress(),'power-path').progress,'east-gate').progress;expect(npcInRange(s,player,'ada',p)).toBe(true);
});
