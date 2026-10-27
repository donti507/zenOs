import {useCallback,useEffect,useRef,useState} from 'react';
import type {MutableRefObject} from 'react';
import {weeklyRecap,type WeeklyRecap,type RecapSettings,type RecapTask} from '../../shared/weeklyRecaps';
import {saveLocalRecaps} from '../lib/localWeeklyRecaps';
type Options={ownerId:string|null;isOffline:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean;stateRef:MutableRefObject<{tasks:RecapTask[]}>};
export function useWeeklyRecaps(options:Options){
 const [weeklyRecaps,setRecaps]=useState<WeeklyRecap[]>([]),[recapSettings,setSettings]=useState<RecapSettings|null>(null),[recapLoading,setLoading]=useState(false),[recapGenerating,setGenerating]=useState(false),[recapError,setError]=useState('');
 const generation=useRef(0),reads=useRef(0),registered=useRef(''),running=useRef(false);
 const key=options.ownerId+':'+options.isOffline;const [loadedFor,setLoadedFor]=useState('');
 useEffect(()=>{setLoadedFor(key);++generation.current;++reads.current;registered.current='';running.current=false;setRecaps([]);setSettings(null);setLoading(false);setGenerating(false);setError('');return()=>{++generation.current;++reads.current;};},[options.ownerId,options.isOffline]);
 const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const request=useCallback(async(path:string,body?:unknown,signal?:AbortSignal)=>{
  if(!options.ownerId||options.isOffline||!options.isCurrent())throw new Error('Sign in to read cloud recaps.');const token=await options.getToken();if(!token||!options.isCurrent())throw new Error('Your account changed.');
  const response=await fetch('/api/weekly-recaps'+path,{method:body===undefined?'GET':'POST',cache:'no-store',signal,headers:{Authorization:`Bearer ${token}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>({}));if(!options.isCurrent())throw new Error('Your account changed.');if(!response.ok)throw new Error(data.error||'Could not load your weekly recap.');return data;
 },[options.ownerId,options.isOffline,options.getToken]);
 const register=useCallback(async(signal?:AbortSignal)=>{const key=options.ownerId+':'+timeZone();if(registered.current!==key){await request('/settings',{timeZone:timeZone()},signal);if(options.isCurrent())registered.current=key;}},[request,options.ownerId]);
 const local=useCallback((mode:'read'|'manual'|'settings',enabled?:boolean)=>{const data=saveLocalRecaps(options.stateRef.current.tasks,new Date(),timeZone(),mode,enabled);return {recaps:data.recaps,settings:{enabled:data.enabled,timeZone:timeZone(),nextDueAt:new Date(data.nextSunday+'T18:00:00').toISOString()}};},[options.ownerId,options.isOffline]);
 const refreshWeeklyRecaps=useCallback(async(signal?:AbortSignal)=>{
  if(!options.ownerId||!options.isCurrent())return;const scope=generation.current,read=++reads.current;setLoading(true);setError('');
  try{let data:{recaps:WeeklyRecap[];settings:RecapSettings|null};if(options.isOffline)data=local('read');else{await register(signal);const result=await request('',undefined,signal);data={recaps:(result.recaps||[]).map(weeklyRecap).slice(0,8),settings:result.settings};}if(scope===generation.current&&read===reads.current&&options.isCurrent()){setRecaps(data.recaps);setSettings(data.settings);}}
  catch(error){if(scope===generation.current&&read===reads.current&&options.isCurrent()&&!signal?.aborted)setError(error instanceof Error?error.message:'Could not read your weekly recaps.');throw error;}
  finally{if(scope===generation.current&&read===reads.current)setLoading(false);}
 },[request,register,local,options.ownerId,options.isOffline]);
 const mutate=useCallback(async(mode:'manual'|'settings',enabled?:boolean)=>{
  if(running.current||!options.ownerId||!options.isCurrent())return;const scope=generation.current;running.current=true;++reads.current;setGenerating(true);setError('');
  try{if(options.isOffline){const data=local(mode,enabled);if(scope===generation.current&&options.isCurrent()){setRecaps(data.recaps);setSettings(data.settings);setLoading(false);}}else{await register();await request(mode==='manual'?'/generate':'/settings',mode==='manual'?{}:{timeZone:timeZone(),enabled});if(scope===generation.current)await refreshWeeklyRecaps();}}
  catch(error){if(scope===generation.current&&options.isCurrent())setError(error instanceof Error?error.message:'Could not save your recap.');throw error;}
  finally{if(scope===generation.current){running.current=false;setGenerating(false);}}
 },[request,register,refreshWeeklyRecaps,local,options.ownerId,options.isOffline]);
 const generateWeeklyRecap=useCallback(()=>mutate('manual'),[mutate]);
 const setWeeklyRecapAutomatic=useCallback((enabled:boolean)=>mutate('settings',enabled),[mutate]);
 return {weeklyRecaps:loadedFor===key?weeklyRecaps:[],recapSettings:loadedFor===key?recapSettings:null,recapLoading:loadedFor===key&&recapLoading,recapGenerating:loadedFor===key&&recapGenerating,recapError:loadedFor===key?recapError:'',refreshWeeklyRecaps,generateWeeklyRecap,setWeeklyRecapAutomatic};
}
