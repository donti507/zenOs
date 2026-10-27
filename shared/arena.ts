import {isSpaceId,spaceText} from './space';
export const ARENA_OUTPUT_LIMIT=24000;
export type ArenaSide=0|1;
export type ArenaWinner='a'|'b';
export type ArenaVote={id:string;models:[string,string];winner:ArenaWinner};
export type ArenaLeader={model:string;wins:number;comparisons:number};
export type ArenaRound={id:string|null;models:[string,string];answers:[string,string];states:[string,string];eligible:boolean;winner:ArenaWinner|null};
export type ArenaEvent={type:'delta';side:ArenaSide;text:string}|{type:'done'|'error';side:ArenaSide}|{type:'complete';id:string}|{type:'finished'|'ping'};
export const arenaModel=(value:unknown):string=>{
 if(typeof value!=='string'||!/^[a-z0-9_.:/-]{1,120}$/i.test(value)||value.includes('://'))throw new Error('Invalid model.');return value;
};
export function arenaModels(value:unknown):[string,string]{
 if(!Array.isArray(value)||value.length!==2)throw new Error('Choose two models.');
 const a=arenaModel(value[0]),b=arenaModel(value[1]);if(a===b)throw new Error('Choose two different models.');return [a,b];
}
export function arenaRequest(value:any){return {prompt:spaceText(value?.prompt,2000,'Arena prompt'),models:arenaModels(value?.models)};}
export function arenaVote(value:any):ArenaVote{
 if(!isSpaceId(value?.id)||!['a','b'].includes(value?.winner))throw new Error('Invalid vote.');
 return {id:value.id,models:arenaModels(value.models),winner:value.winner};
}
export function arenaLeaders(votes:ArenaVote[]):ArenaLeader[]{
 const rows=new Map<string,ArenaLeader>();
 for(const vote of votes) vote.models.forEach((model,index)=>{const row=rows.get(model)||{model,wins:0,comparisons:0};row.comparisons++;if(vote.winner===(index===0?'a':'b'))row.wins++;rows.set(model,row);});
 return [...rows.values()].sort((a,b)=>b.wins-a.wins||a.model.localeCompare(b.model));
}
export function arenaLeader(value:any):ArenaLeader{
 const wins=Number(value?.wins),comparisons=Number(value?.comparisons);
 if(!Number.isSafeInteger(wins)||!Number.isSafeInteger(comparisons)||wins<0||comparisons<1||wins>comparisons)throw new Error('Invalid leaderboard.');
 return {model:arenaModel(value.model),wins,comparisons};
}
export function arenaEvent(value:any):ArenaEvent{
 if(!value||typeof value!=='object')throw new Error('Invalid Arena stream.');
 if(value.type==='delta'&&(value.side===0||value.side===1)&&typeof value.text==='string'&&value.text.length<=ARENA_OUTPUT_LIMIT)return {type:'delta',side:value.side,text:value.text};
 if(['done','error'].includes(value.type)&&(value.side===0||value.side===1))return {type:value.type,side:value.side};
 if(value.type==='complete'&&isSpaceId(value.id))return {type:'complete',id:value.id};
 if(value.type==='finished'||value.type==='ping')return {type:value.type};
 throw new Error('Invalid Arena stream.');
}
