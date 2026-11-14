import type {AdventureSpec} from '../spec';
export function npcDialogue(spec:AdventureSpec,npcId:string){
 const npc=spec.npcs.find(n=>n.id===npcId);return (npc?.dialogue||[]).map(line=>({...line,speakerName:line.speaker==='player'?null:spec.npcs.find(n=>n.id===line.speaker)?.name??npc!.name}));
}
export function dialogueIndex(index:number,length:number,step:number){return Math.max(0,Math.min(Math.max(0,length-1),index+step));}
