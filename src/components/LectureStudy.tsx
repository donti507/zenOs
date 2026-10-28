import {tr,useUiLanguage,uiLocale} from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { Lecture } from '../../shared/lectures';
import { useZenos } from '../context/ZenosContext';
import { btn, card } from './ui/kit';
export default function LectureStudy({lecture,unsaved=false}:{lecture:Lecture;unsaved?:boolean}){
  useUiLanguage();
 const {reviewLectureCard,addLectureActionTask}=useZenos();
 const [index,setIndex]=useState(0);const [flipped,setFlipped]=useState(false);const [busy,setBusy]=useState('');const [error,setError]=useState('');const running=useRef(false);
 useEffect(()=>{setIndex(0);setFlipped(false);setError('');},[lecture.id]);
 const run=async(key:string,operation:()=>Promise<void>)=>{if(running.current)return;running.current=true;setBusy(key);setError('');try{await operation();}catch{setError('Could not save this change. Please try again.');}finally{running.current=false;setBusy('');}};
 const flashcard=lecture.flashcards[index];
 return <article className="min-w-0 space-y-5" aria-label={tr("Study notes: {{0}}",lecture.title)}>
  <header><h2 className="text-xl font-semibold break-words">{lecture.title}</h2><p className="text-sm text-on-surface-variant">{Math.ceil(lecture.durationSeconds/60)}{tr(" min · ")}{new Date(lecture.createdAt).toLocaleDateString(uiLocale())}{unsaved?tr(" · Not saved yet"):''}</p></header>
  <section className={`${card} p-5`}><h3 className="font-semibold mb-3">{tr("Summary")}</h3><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-on-surface-variant">{lecture.summary}</p></section>
  <section className={`${card} p-5`}><h3 className="font-semibold mb-3">{tr("Key points")}</h3><ul className="list-disc pl-5 space-y-2 text-on-surface-variant">{lecture.keyPoints.map((point,i)=><li key={i} className="break-words [overflow-wrap:anywhere]">{point}</li>)}</ul></section>
  <section className={`${card} p-5`} aria-label={tr("Flashcard review")}>
   <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 className="font-semibold">{tr("Flashcards")}</h3><span className="text-xs text-on-surface-variant">{lecture.flashcards.filter(c=>c.known===true).length}{tr("/10 known · ")}{index+1}/10</span></div>
   <button className="w-full min-h-40 max-h-72 overflow-y-auto text-left rounded-xl p-5 bg-surface-container-low focus-visible:outline-primary disabled:opacity-50" aria-label={tr("Flip flashcard {{0}}",index+1)} aria-pressed={flipped} disabled={!!busy} onClick={()=>setFlipped(value=>!value)}>
    <span className="block text-xs uppercase tracking-wide text-primary mb-3">{flipped?tr("Answer"):tr("Question")}{tr(" · tap to flip")}</span><span className="block break-words [overflow-wrap:anywhere]">{flipped?flashcard.answer:flashcard.question}</span>
   </button>
   <div className="flex flex-wrap gap-2 mt-3">
    <button className={btn.secondary} disabled={!!busy} onClick={()=>{setIndex((index+9)%10);setFlipped(false);}}>{tr("Previous")}</button>
    <button className={btn.primary} disabled={!!busy||unsaved} onClick={()=>run('review',async()=>{await reviewLectureCard(lecture.id,index,true);setIndex((index+1)%10);setFlipped(false);})}>{tr("Known")}</button>
    <button className={btn.secondary} disabled={!!busy||unsaved} onClick={()=>run('review',async()=>{await reviewLectureCard(lecture.id,index,false);setIndex((index+1)%10);setFlipped(false);})}>{tr("Unknown")}</button>
    <button className={btn.secondary} disabled={!!busy} onClick={()=>{setIndex((index+1)%10);setFlipped(false);}}>{tr("Next")}</button>
   </div>
  </section>
  <section className={`${card} p-5`}><h3 className="font-semibold mb-3">{tr("Action items")}</h3>{!lecture.actionItems.length?<p className="text-on-surface-variant text-sm">{tr("No action items were found.")}</p>:<ul className="space-y-3">{lecture.actionItems.map((item,i)=><li key={i} className="flex flex-col sm:flex-row sm:items-center gap-2"><span className="flex-1 min-w-0 break-words [overflow-wrap:anywhere]">{item.title}</span><button className={`${btn.secondary} shrink-0`} disabled={!!busy||unsaved||!!item.taskId} onClick={()=>run(`action-${i}`,()=>addLectureActionTask(lecture.id,i))}>{item.taskId?tr("Added"):busy===`action-${i}`?tr("Adding…"):tr("Add as task")}</button></li>)}</ul>}</section>
  {error&&<p role="alert" className="text-sm text-error">{tr(error)}</p>}
  <details className={`${card} p-5`}><summary className="cursor-pointer font-medium">{tr("Transcript")}</summary><p className="mt-3 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-on-surface-variant">{lecture.transcript||tr("Loading transcript…")}</p></details>
 </article>;
}
