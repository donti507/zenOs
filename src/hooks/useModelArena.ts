import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {localArenaVotes,voteLocalArena,readArenaStream} from '../lib/arena';
import {notifyDanteUsage} from '../lib/usageEvents';
import {arenaRequest,arenaLeader,arenaLeaders,ARENA_OUTPUT_LIMIT,type ArenaRound,type ArenaLeader,type ArenaWinner} from '../../shared/arena';
type Options={ownerId:string|null;isOffline:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean};
export function useModelArena(options:Options){
 const latest=useRef(options);latest.current=options;
 const scope=`${options.ownerId}:${options.isOffline}`;
 const [dataScope,setDataScope]=useState(scope);
 const [arenaRound,setRound]=useState<ArenaRound|null>(null);
 const roundRef=useRef(arenaRound);roundRef.current=arenaRound;
 const [arenaRunning,setRunning]=useState(false),[arenaVoting,setVoting]=useState(false);
 const [arenaError,setError]=useState<string|null>(null),[arenaBoardError,setBoardError]=useState<string|null>(null);
 const [arenaLeaderboard,setBoard]=useState<ArenaLeader[]>([]);
 const abortRef=useRef<AbortController|null>(null),boardSeq=useRef(0),voteLock=useRef(false),boardActive=useRef(false);
 const current=()=>latest.current.ownerId===options.ownerId&&latest.current.isOffline===options.isOffline&&latest.current.isCurrent();
 const refreshArenaLeaderboard=useCallback(async()=>{
  const request=++boardSeq.current;if(!options.ownerId||!current())return;boardActive.current=true;
  try{
   let rows:ArenaLeader[];
   if(options.isOffline)rows=arenaLeaders(localArenaVotes());
   else{const {data,error}=await supabase.rpc('space_arena_leaderboard');if(error)throw error;rows=(data||[]).map(arenaLeader);}
   if(current()&&request===boardSeq.current){setBoard(rows);setBoardError(null);}
  }catch{if(current()&&request===boardSeq.current)setBoardError('Could not load your votes. Apply the latest migration or check local storage.');}
 },[options.ownerId,options.isOffline]);
 useEffect(()=>{
  abortRef.current?.abort();abortRef.current=null;++boardSeq.current;voteLock.current=false;boardActive.current=false;
  setDataScope(scope);setRound(null);setRunning(false);setVoting(false);setError(null);setBoardError(null);setBoard([]);
  if(options.ownerId&&options.isOffline)void refreshArenaLeaderboard();
  const focus=()=>{if(boardActive.current)void refreshArenaLeaderboard();};
  window.addEventListener('focus',focus);
  return ()=>{abortRef.current?.abort();abortRef.current=null;++boardSeq.current;window.removeEventListener('focus',focus);};
 },[options.ownerId,options.isOffline,refreshArenaLeaderboard]);
 const cancelArena=useCallback(()=>{if(current())abortRef.current?.abort();},[options.ownerId,options.isOffline]);
 const compareArena=useCallback(async(prompt:string,models:[string,string])=>{
  if(!current())throw new Error('Your account changed.');
  if(abortRef.current)throw new Error('A comparison is already running.');
  const input=arenaRequest({prompt,models}),controller=new AbortController();abortRef.current=controller;
  const active=()=>current()&&abortRef.current===controller&&!controller.signal.aborted;
  let round:ArenaRound={id:null,models:input.models,answers:['',''],states:['waiting','waiting'],eligible:false,winner:null};
  const publish=()=>{roundRef.current=round;setRound({...round,answers:[...round.answers],states:[...round.states]});};
  publish();setRunning(true);setError(null);
  try{
   const token=await options.getToken();if(!active())throw new DOMException('Comparison cancelled.','AbortError');
   const response=await fetch('/api/space/arena/compare',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.error==='string'?data.error:'Could not start the comparison.');}
   await readArenaStream(response,controller.signal,event=>{
    if(!active())return;
    if(event.type==='delta'){
     if(!['waiting','streaming'].includes(round.states[event.side]))throw new Error('Invalid Arena stream order.');
     round.answers[event.side]+=event.text;if(round.answers[event.side].length>ARENA_OUTPUT_LIMIT)throw new Error('Answer too long.');round.states[event.side]='streaming';
    }else if(event.type==='done'||event.type==='error'){
     if(!['waiting','streaming'].includes(round.states[event.side]))throw new Error('Invalid Arena stream order.');
     if(event.type==='done'&&!round.answers[event.side].trim())throw new Error('Empty answer.');round.states[event.side]=event.type;
    }else if(event.type==='complete'){
     if(!round.states.every(state=>state==='done'))throw new Error('Incomplete comparison.');round.id=event.id;round.eligible=true;
    }else if(event.type==='finished'){setError('The comparison could not finish or save. You can read partial answers, but cannot vote.');}
    if(event.type!=='ping')publish();
   });
  }catch(error){
   if(current()&&abortRef.current===controller){round.eligible=false;round.states=round.states.map(state=>state==='done'?state:'stopped') as [string,string];publish();setError(controller.signal.aborted?'Comparison stopped. Admitted requests use 2 messages.':error instanceof Error?error.message:'Comparison failed.');}
  }finally{
   notifyDanteUsage();if(abortRef.current===controller){abortRef.current=null;if(current())setRunning(false);}
  }
 },[options.ownerId,options.isOffline,options.getToken]);
 const voteArena=useCallback(async(winner:ArenaWinner)=>{
  const round=roundRef.current;
  if(!current()||!round?.id||!round.eligible||round.winner||!['a','b'].includes(winner)||voteLock.current)throw new Error('This comparison is not available for voting.');
  voteLock.current=true;setVoting(true);setError(null);
  try{
   if(options.isOffline)voteLocalArena({id:round.id,models:round.models,winner});
   else{const {data,error}=await supabase.rpc('vote_space_arena',{p_id:round.id,p_winner:winner});if(error||data!==winner)throw new Error('Vote was not confirmed. Retry the same choice or refresh your leaderboard.');}
   if(!current())return;
   if(roundRef.current?.id===round.id){const saved={...round,winner};roundRef.current=saved;setRound(saved);}
   await refreshArenaLeaderboard();
  }catch(error){if(current())setError(error instanceof Error?error.message:'Could not save your vote.');throw error;}
  finally{if(current()){voteLock.current=false;setVoting(false);}}
 },[options.ownerId,options.isOffline,refreshArenaLeaderboard]);
 const visible=dataScope===scope;
 return {arenaRound:visible?arenaRound:null,arenaRunning:visible&&arenaRunning,arenaVoting:visible&&arenaVoting,arenaError:visible?arenaError:null,arenaBoardError:visible?arenaBoardError:null,arenaLeaderboard:visible?arenaLeaderboard:[],compareArena,cancelArena,voteArena,refreshArenaLeaderboard};
}
