import {useCallback,useEffect,useRef,useState} from 'react';
import {transitionQuest,type QuestProgress} from '../game/systems/quest';
import type {AdventureSpec} from '../game/spec';
export type AdventureSettings={lowPerformance:boolean;reducedMotion:boolean};
const KEY='zenos_adventure_settings_v1';
export const SAMPLE_ADVENTURES=[{id:'lost-binary-kingdom',title:'The Lost Binary Kingdom',description:'Explore a quiet kingdom built around binary numbers and logic.',missions:3}] as const;
export function useAdventures(options:{ownerId?:string|null;isOffline?:boolean}={}){
 const owner=(options.isOffline?'local:':'cloud:')+(options.ownerId||'anonymous'),latest=useRef(owner);latest.current=owner;
 const [runs,setRuns]=useState<{owner:string;progress:Record<string,QuestProgress>}>({owner,progress:{}}),runsRef=useRef(runs),loaded=useRef<{owner:string;spec:AdventureSpec}|null>(null);
 useEffect(()=>{runsRef.current={owner,progress:{}};setRuns(runsRef.current);loaded.current=null;},[owner]);
 const [adventureSettings,setSettings]=useState<AdventureSettings>(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||'{}');return {lowPerformance:p?.lowPerformance===true,reducedMotion:p?.reducedMotion===true};}catch{return {lowPerformance:false,reducedMotion:false};}});
 const setAdventureSettings=useCallback((patch:Partial<AdventureSettings>)=>setSettings(previous=>{const next={lowPerformance:typeof patch.lowPerformance==='boolean'?patch.lowPerformance:previous.lowPerformance,reducedMotion:typeof patch.reducedMotion==='boolean'?patch.reducedMotion:previous.reducedMotion};try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Settings remain available without storage. */}return next;}),[]);
 const loadAdventure=useCallback(async(id:string):Promise<AdventureSpec>=>{
  if(id!=='lost-binary-kingdom')throw new Error('Adventure not found.');const spec=(await import('../game/samples/lost-binary-kingdom')).lostBinaryKingdom;
  if(latest.current!==owner)throw new Error('Your account changed.');loaded.current={owner,spec};return spec;
 },[owner]);
 const advanceAdventureQuest=useCallback((id:string,action:{type:'accept'|'complete';missionId:string})=>{
  if(latest.current!==owner||id!=='lost-binary-kingdom'||loaded.current?.owner!==owner)return null;
  const result=transitionQuest(loaded.current.spec,runsRef.current.owner===owner?runsRef.current.progress[id]:undefined,action);
  const progress={...(runsRef.current.owner===owner?runsRef.current.progress:{}),[id]:result.progress};runsRef.current={owner,progress};setRuns(runsRef.current);return result;
 },[owner]);
 return {adventures:SAMPLE_ADVENTURES,adventureSettings,setAdventureSettings,loadAdventure,adventureProgress:runs.owner===owner?runs.progress:{},advanceAdventureQuest};
}
