import { z } from 'zod';
import {GATE_AREAS,insideArea} from './systems/world';
import { VILLAGE } from './templates/village';
export const SPEC_VERSION = 1 as const;
const id=z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
// Plain text only, including inside future AI-generated specs. Never accept markup or controls.
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[<>\u0000-\u0008\u000b-\u001f\u007f]/u.test(value),'Plain text required');
const hints=z.tuple([text(200),text(200),text(200)]);
const common={prompt:text(300),hints,difficulty:z.union([z.literal(1),z.literal(2),z.literal(3)])};
const gate=z.strictObject({type:z.literal('gate'),...common,input:z.enum(['number','text','choice']),choices:z.array(text(100)).min(2).max(6).optional()}).superRefine((p,ctx)=>{
 if((p.input==='choice')!==!!p.choices)ctx.addIssue({code:'custom',message:'Choices required only for choice input'});
 if(p.choices&&new Set(p.choices).size!==p.choices.length)ctx.addIssue({code:'custom',message:'Choices must be distinct'});
});
export const puzzleSchema=z.discriminatedUnion('type',[
 gate,
 z.strictObject({type:z.literal('sequence'),...common,items:z.array(text(100)).min(3).max(8)}),
 z.strictObject({type:z.literal('match'),...common,left:z.array(text(100)).min(3).max(6),right:z.array(text(100)).min(3).max(6)}).refine(p=>p.left.length===p.right.length,'Matching sides must have equal length'),
]);
const base=z.strictObject({
 specVersion:z.literal(SPEC_VERSION),title:text(80),theme:z.enum(['digital-kingdom','forest-academy','space-lab','ancient-library']),template:z.literal('isometric-village-v1'),
 objectives:z.array(z.strictObject({id,text:text(160),conceptIds:z.array(id).min(1).max(12)})).min(1).max(12),
 concepts:z.array(z.strictObject({id,name:text(60),misconception:text(200).optional()})).min(1).max(20),
 npcs:z.array(z.strictObject({id,name:text(60),role:z.enum(['guide','keeper','sage']),slot:z.enum(['square','archive','observatory']),dialogue:z.array(z.strictObject({speaker:id,text:text(240)})).min(1).max(12)})).min(1).max(3),
 missions:z.array(z.strictObject({id,title:text(80),objectiveId:id,npcId:id,prerequisites:z.array(id).max(8),puzzle:puzzleSchema,xp:z.number().int().min(10).max(100),unlocks:z.strictObject({gateSlot:z.enum(['east-gate','archive-gate','observatory-gate'])}).optional(),sources:z.array(z.strictObject({ref:text(80),quote:text(200)})).min(1).max(4)})).min(3).max(8),
 finale:z.strictObject({missionIds:z.array(id).min(1).max(8),text:text(300)}),
});
export const adventureSpecSchema=base.superRefine((s,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 const all=[...s.concepts,...s.objectives,...s.npcs,...s.missions].map(v=>v.id);
 if(new Set(all).size!==all.length||all.includes('player'))issue('IDs must be globally unique and player is reserved');
 const concepts=new Set(s.concepts.map(v=>v.id)),objectives=new Set(s.objectives.map(v=>v.id)),npcs=new Set(s.npcs.map(v=>v.id)),missions=new Map(s.missions.map(v=>[v.id,v]));
 if(new Set(s.npcs.map(v=>v.slot)).size!==s.npcs.length)issue('NPC slots must be unique');
 for(const objective of s.objectives)if(objective.conceptIds.some(v=>!concepts.has(v))||new Set(objective.conceptIds).size!==objective.conceptIds.length)issue('Unknown or duplicate concept reference');
 for(const npc of s.npcs){if(!(npc.slot in VILLAGE.npcSlots))issue('Unknown NPC slot');for(const line of npc.dialogue)if(line.speaker!=='player'&&!npcs.has(line.speaker))issue('Unknown dialogue speaker');}
 for(const mission of s.missions){
  if(!objectives.has(mission.objectiveId)||!npcs.has(mission.npcId))issue('Unknown objective or NPC reference');
  if(mission.prerequisites.some(v=>!missions.has(v))||new Set(mission.prerequisites).size!==mission.prerequisites.length)issue('Unknown or duplicate prerequisite');
  if(mission.unlocks&&!VILLAGE.gateSlots.includes(mission.unlocks.gateSlot))issue('Unknown gate slot');
 }
 const visiting=new Set<string>(),done=new Set<string>();
 const visit=(key:string)=>{if(visiting.has(key)){issue('Prerequisite cycle');return;}if(done.has(key))return;visiting.add(key);for(const ref of missions.get(key)?.prerequisites||[])if(missions.has(ref))visit(ref);visiting.delete(key);done.add(key);};
 for(const mission of s.missions)visit(mission.id);
 // Prove an ordering exists in which each NPC can be reached before its mission unlock.
 const possible=new Set<string>(),open=new Set<string>(),gates=[...new Set(s.missions.flatMap(m=>m.unlocks?[m.unlocks.gateSlot]:[]))];
 for(let pass=0;pass<s.missions.length;pass++)for(const mission of s.missions){
  const npc=s.npcs.find(n=>n.id===mission.npcId);if(!npc||possible.has(mission.id)||!mission.prerequisites.every(id=>possible.has(id)))continue;
  if(gates.some(gate=>!open.has(gate)&&insideArea(VILLAGE.npcSlots[npc.slot],GATE_AREAS[gate])))continue;
  possible.add(mission.id);if(mission.unlocks)open.add(mission.unlocks.gateSlot);
 }
 if(possible.size!==s.missions.length)issue('A mission is unreachable behind prerequisites or a locked area');
 if(s.finale.missionIds.some(v=>!missions.has(v))||new Set(s.finale.missionIds).size!==s.finale.missionIds.length)issue('Unknown or duplicate finale reference');
});
export type AdventureSpec=z.infer<typeof adventureSpecSchema>;
/** Bound size before parsing/validation. Invalid/future versions never reach the engine. */
export function validateAdventureSpec(input:unknown):AdventureSpec {
 let raw:unknown=input;
 if(typeof raw==='string'){if(raw.length>65536)throw new Error('Adventure spec is too large.');try{raw=JSON.parse(raw);}catch{throw new Error('Invalid adventure JSON.');}}
 try{const size=JSON.stringify(raw);if(!size||size.length>65536)throw new Error();}catch{throw new Error('Adventure spec is too large or invalid.');}
 if(raw&&typeof raw==='object'&&'specVersion' in raw&&raw.specVersion!==SPEC_VERSION)throw new Error('Unsupported adventure version. Update ZEN OS to play this adventure.');
 const result=adventureSpecSchema.safeParse(raw);if(!result.success)throw new Error('This adventure is invalid and cannot be played.');return result.data;
}
