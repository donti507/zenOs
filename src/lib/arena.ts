import {arenaEvent,arenaVote,arenaLeaders,type ArenaEvent,type ArenaVote,type ArenaLeader} from '../../shared/arena';
const LOCAL_KEY='zenos_arena_votes';
export function localArenaVotes():ArenaVote[]{
 const raw=localStorage.getItem(LOCAL_KEY);if(!raw)return [];
 const rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('Could not read local Arena votes.');
 const seen=new Set<string>();return rows.map(arenaVote).filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;});
}
export function voteLocalArena(raw:ArenaVote):ArenaLeader[]{
 const vote=arenaVote(raw),rows=localArenaVotes(),existing=rows.find(row=>row.id===vote.id);
 if(existing&&(existing.winner!==vote.winner||existing.models.join()!==vote.models.join()))throw new Error('Vote already recorded.');
 if(!existing){rows.push(vote);localStorage.setItem(LOCAL_KEY,JSON.stringify(rows));}
 return arenaLeaders(rows);
}
/** Chunk boundaries are unrelated to UTF-8 characters or NDJSON lines. */
export async function readArenaStream(response:Response,signal:AbortSignal,onEvent:(event:ArenaEvent)=>void){
 if(!response.body)throw new Error('Arena streaming is unavailable.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',total=0,terminal=false;
 const process=(line:string)=>{if(!line.trim())return;if(terminal)throw new Error('Unexpected Arena data.');const event=arenaEvent(JSON.parse(line));if(event.type==='complete'||event.type==='finished')terminal=true;onEvent(event);};
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;total+=value.byteLength;if(total>8*1024*1024)throw new Error('Arena response too large.');buffer+=decoder.decode(value,{stream:true});let newline:number;while((newline=buffer.indexOf('\n'))>=0){process(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}if(buffer.length>100000)throw new Error('Arena stream line too large.');}
  buffer+=decoder.decode();if(buffer.trim())process(buffer);if(!terminal)throw new Error('Comparison interrupted. Start a new comparison to try again.');
 }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
