import {useCallback,useEffect,useRef,useState} from 'react';
import {normalizeProgress,questStatus,transitionQuest,type QuestProgress} from '../game/systems/quest';
import {emptyPuzzleStats,maxHintLevel,parsePuzzleAnswer,type PuzzleStats} from '../game/mechanics/types';
import type {AdventureSpec} from '../game/spec';
export type AdventureSettings={lowPerformance:boolean;reducedMotion:boolean};
const KEY='zenos_adventure_settings_v1',SAMPLE='lost-binary-kingdom';
export const SAMPLE_ADVENTURES=[{id:SAMPLE,title:'The Lost Binary Kingdom',description:'Explore a quiet kingdom built around binary numbers and logic.',missions:3}] as const;
type Run={scope:string;progress:Record<string,QuestProgress>;stats:Record<string,Record<string,PuzzleStats>>};
export function useAdventures(options:{ownerId?:string|null;isOffline?:boolean}={}){
 const owner=(options.isOffline?'local:':'cloud:')+(options.ownerId||'anonymous'),scopeRef=useRef({owner,epoch:0});
 if(scopeRef.current.owner!==owner)scopeRef.current={owner,epoch:scopeRef.current.epoch+1};
 const scope=owner+':'+scopeRef.current.epoch,current=useRef(scope);current.current=scope;
 const fresh=():Run=>({scope,progress:{},stats:{}});
 const [runs,setRuns]=useState<Run>(fresh),runsRef=useRef(runs),loaded=useRef<{scope:string;spec:AdventureSpec}|null>(null),pending=useRef(new Map<string,symbol>());
 useEffect(()=>{runsRef.current=fresh();setRuns(runsRef.current);loaded.current=null;pending.current.clear();},[scope]);
 const [adventureSettings,setSettings]=useState<AdventureSettings>(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||'{}');return {lowPerformance:p?.lowPerformance===true,reducedMotion:p?.reducedMotion===true};}catch{return {lowPerformance:false,reducedMotion:false};}});
 const setAdventureSettings=useCallback((patch:Partial<AdventureSettings>)=>setSettings(previous=>{const next={lowPerformance:typeof patch.lowPerformance==='boolean'?patch.lowPerformance:previous.lowPerformance,reducedMotion:typeof patch.reducedMotion==='boolean'?patch.reducedMotion:previous.reducedMotion};try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Settings remain available without storage. */}return next;}),[]);
 const loadAdventure=useCallback(async(id:string):Promise<AdventureSpec>=>{
  if(id!==SAMPLE)throw new Error('Adventure not found.');const spec=(await import('../game/samples/lost-binary-kingdom')).lostBinaryKingdom;
  if(current.current!==scope)throw new Error('Your account changed.');loaded.current={scope,spec};return spec;
 },[scope]);
 const available=(id:string)=>current.current===scope&&id===SAMPLE&&loaded.current?.scope===scope;
 const state=()=>runsRef.current.scope===scope?runsRef.current:fresh();
 const commit=(next:Run)=>{runsRef.current=next;setRuns(next);};
 const advanceAdventureQuest=useCallback((id:string,action:{type:'accept';missionId:string})=>{
  if(!available(id)||action.type!=='accept')return null;
  const before=state(),result=transitionQuest(loaded.current!.spec,before.progress[id],action);
  commit({...before,progress:{...before.progress,[id]:result.progress}});return result;
 },[scope]);
 const requestAdventureHint=useCallback((id:string,missionId:string)=>{
  if(!available(id)||questStatus(loaded.current!.spec,state().progress[id]??{accepted:[],completed:[]},missionId)!=='active')return null;
  const before=state(),stats=before.stats[id]?.[missionId]??emptyPuzzleStats();
  if(stats.hintLevel>=maxHintLevel(stats))return stats;const next={...stats,hintLevel:stats.hintLevel+1};
  commit({...before,stats:{...before.stats,[id]:{...before.stats[id],[missionId]:next}}});return next;
 },[scope]);
 const submitAdventurePuzzle=useCallback(async(id:string,missionId:string,input:unknown,signal?:AbortSignal)=>{
  if(!available(id)||signal?.aborted)return null;const spec=loaded.current!.spec,mission=spec.missions.find(m=>m.id===missionId),before=state();
  if(!mission||questStatus(spec,before.progress[id]??{accepted:[],completed:[]},missionId)!=='active')return null;
  const answer=parsePuzzleAnswer(mission.puzzle,input),initialStats=before.stats[id]?.[missionId]??emptyPuzzleStats();
  if(!answer)return {check:{correct:false,code:'invalid' as const},stats:initialStats,progress:normalizeProgress(spec,before.progress[id]),xpGranted:0,newlyUnlocked:[] as string[],missionId:null,preview:true};
  const key=scope+'/'+missionId;if(pending.current.has(key))return null;const ticket=Symbol();pending.current.set(key,ticket);
  const release=()=>{if(pending.current.get(key)===ticket)pending.current.delete(key);};signal?.addEventListener('abort',release,{once:true});
  try{
   const {verifyLocalSample}=await import('../game/samples/local-verifier');
   if(!available(id)||signal?.aborted)return null;const check=await verifyLocalSample(missionId,answer);
   if(!available(id)||signal?.aborted||questStatus(spec,state().progress[id]??{accepted:[],completed:[]},missionId)!=='active')return null;
   const latest=state(),old=latest.stats[id]?.[missionId]??emptyPuzzleStats();
   const stats={...old,attempts:Math.min(1000,old.attempts+(check.code==='invalid'?0:1)),wrongAttempts:Math.min(1000,old.wrongAttempts+(check.code==='incorrect'?1:0))};
   const result=check.correct?transitionQuest(spec,latest.progress[id],{type:'complete',missionId}):{progress:normalizeProgress(spec,latest.progress[id]),xpGranted:0,newlyUnlocked:[] as string[],missionId:null};
   commit({...latest,progress:{...latest.progress,[id]:result.progress},stats:{...latest.stats,[id]:{...latest.stats[id],[missionId]:stats}}});
   return {...result,check,stats,preview:true};
  }catch{if(current.current!==scope||signal?.aborted)return null;throw new Error('Could not check this puzzle. Please try again.');}
  finally{signal?.removeEventListener('abort',release);release();}
 },[scope]);
 return {adventures:SAMPLE_ADVENTURES,adventureSettings,setAdventureSettings,loadAdventure,adventureProgress:runs.scope===scope?runs.progress:{},adventurePuzzleStats:runs.scope===scope?runs.stats:{},advanceAdventureQuest,submitAdventurePuzzle,requestAdventureHint};
}
