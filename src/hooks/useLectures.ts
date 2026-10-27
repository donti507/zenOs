import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { lectureFromRow, lectureToRow, type Lecture } from '../../shared/lectures';
import { localLectures, changeLocalLecture } from '../lib/localLectures';
import { supabase } from '../lib/supabase';
import { insertWorkspaceRow } from '../lib/workspaceRealtime';
import { today } from '../lib/utils';
import type { ZenosState, Task } from '../types';
const columns='id,title,duration_seconds,summary,key_points,flashcards,action_items,created_at';
const merge=(state:ZenosState,row:Lecture):ZenosState=>({...state,lectures:[row,...(state.lectures||[]).filter(item=>item.id!==row.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
export function useLectures(options:{ownerId:string|null;isOffline:boolean;isCurrent:()=>boolean;stateRef:MutableRefObject<ZenosState>;setState:Dispatch<SetStateAction<ZenosState>>}){
 const latest=useRef(options);latest.current=options;const read=useRef(0);
 const [lecturesLoading,setLoading]=useState(false);const [lecturesError,setError]=useState<string|null>(null);
 const current=()=>latest.current.ownerId===options.ownerId&&latest.current.isOffline===options.isOffline&&latest.current.isCurrent();
 const refreshLectures=useCallback(async()=>{
  const request=++read.current;if(!options.ownerId||!current())return;setLoading(true);setError(null);
  try{
   let rows:Lecture[]=[];
   if(options.isOffline)rows=await localLectures();
   else for(let offset=0;;offset+=50){
    const {data,error}=await supabase.from('lectures').select(columns).eq('user_id',options.ownerId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);
    if(error)throw error;if(!current()||request!==read.current)return;
    rows.push(...(data||[]).map(row=>lectureFromRow(row,true)));if(!data||data.length<50)break;
   }
   if(current()&&request===read.current)options.setState(state=>current()?{...state,lectures:rows.map(row=>({...row,transcript:row.transcript||(state.lectures||[]).find(old=>old.id===row.id)?.transcript||''}))}:state);
  }catch{if(current()&&request===read.current)setError('Could not load lectures. Check storage or apply the latest database migration.');}
  finally{if(request===read.current)setLoading(false);}
 },[options.ownerId,options.isOffline]);
 useEffect(()=>{
  setError(null);setLoading(false);if(!options.ownerId)return;
  void refreshLectures();const focus=()=>{void refreshLectures();};window.addEventListener('focus',focus);
  return()=>{++read.current;window.removeEventListener('focus',focus);};
 },[options.ownerId,options.isOffline,refreshLectures]);
 const cache=(row:Lecture)=>{if(current()){++read.current;setLoading(false);options.setState(state=>current()?merge(state,row):state);}};
 const loadLecture=useCallback(async(id:string)=>{
  if(!current())throw new Error('Your account changed.');
  const existing=options.stateRef.current.lectures?.find(row=>row.id===id);if(existing?.transcript)return existing;
  if(options.isOffline){const row=(await localLectures()).find(item=>item.id===id);if(!row)throw new Error('Lecture not found.');cache(row);return row;}
  const {data,error}=await supabase.from('lectures').select('*').eq('user_id',options.ownerId).eq('id',id).single();
  if(error||!data)throw new Error('Could not load this lecture.');const row=lectureFromRow(data);if(!current())throw new Error('Your account changed.');cache(row);return row;
 },[options.ownerId,options.isOffline]);
 const saveLecture=useCallback(async(raw:Lecture)=>{
  if(!current()||!options.ownerId)throw new Error('Your account changed.');const lecture=lectureFromRow(raw);let saved:Lecture;
  if(options.isOffline)saved=await changeLocalLecture(lecture.id,existing=>existing||lecture);
  else{
   const {error}=await supabase.from('lectures').upsert({...lectureToRow(lecture),user_id:options.ownerId},{onConflict:'id',ignoreDuplicates:true});
   if(error)throw new Error('Could not save the lecture. Please retry saving.');
   const result=await supabase.from('lectures').select('*').eq('user_id',options.ownerId).eq('id',lecture.id).single();
   if(result.error||!result.data)throw new Error('Could not save the lecture. Please retry saving.');saved=lectureFromRow(result.data);
  }
  if(!current())throw new Error('Your account changed.');cache(saved);return saved;
 },[options.ownerId,options.isOffline]);
 const reviewLectureCard=useCallback(async(id:string,index:number,known:boolean)=>{
  if(!current()||!Number.isInteger(index)||index<0||index>=10||typeof known!=='boolean')throw new Error('Invalid flashcard review.');let saved:Lecture;
  if(options.isOffline)saved=await changeLocalLecture(id,existing=>{if(!existing)throw new Error('Lecture not found.');return {...existing,flashcards:existing.flashcards.map((card,i)=>i===index?{...card,known}:card)};});
  else{const {data,error}=await supabase.rpc('review_lecture_card',{p_lecture_id:id,p_index:index,p_known:known});if(error)throw new Error('Could not save your review.');saved=lectureFromRow(data);}
  if(!current())return;cache(saved);
 },[options.ownerId,options.isOffline]);
 const addLectureActionTask=useCallback(async(id:string,index:number)=>{
  if(!current()||!Number.isInteger(index)||index<0)throw new Error('Your account changed.');let saved:Lecture;
  if(options.isOffline){
   const lecture=(await localLectures()).find(row=>row.id===id);const action=lecture?.actionItems[index];if(!lecture||!action)throw new Error('Lecture action not found.');
   const taskId=action.taskId||`lecture:${id}:${index}`;const state=options.stateRef.current;
   let stored:Task[];try{stored=JSON.parse(localStorage.getItem('zenos_tasks')||'[]');if(!Array.isArray(stored))throw new Error();}catch{throw new Error('Could not read local tasks.');}
   if(!current())throw new Error('Your account changed.');
   const existing=[...state.tasks,...stored].find(task=>String(task.id)===taskId);
   const task:Task=existing||{id:taskId,title:action.title,cat:state.categories.find(c=>c.label.toLowerCase()==='other')?.id||state.categories[0]?.id||'other',status:'todo',date:today(),reminder:'',note:`From lecture: ${lecture.title}`,progress:0,steps:[],recurrence:'none'};
   const tasks=[...stored.filter(t=>String(t.id)!==taskId),task];localStorage.setItem('zenos_tasks',JSON.stringify(tasks));
   options.setState(state=>current()?{...state,tasks:state.tasks.some(t=>String(t.id)===taskId)?state.tasks:[...state.tasks,task]}:state);
   saved=await changeLocalLecture(id,existing=>{if(!existing)throw new Error('Lecture not found.');return {...existing,actionItems:existing.actionItems.map((item,i)=>i===index?{...item,taskId}:item)};});
  }else{
   const {data,error}=await supabase.rpc('add_lecture_task',{p_lecture_id:id,p_index:index,p_date:today()});
   if(error)throw new Error('Could not add this task. Please try again.');saved=lectureFromRow(data.lecture);
   if(current())options.setState(state=>current()?insertWorkspaceRow(state,'tasks',data.task):state);
  }
  if(current())cache(saved);
 },[options.ownerId,options.isOffline]);
 return {lecturesLoading,lecturesError,refreshLectures,loadLecture,saveLecture,reviewLectureCard,addLectureActionTask};
}
