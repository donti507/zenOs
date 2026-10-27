import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { MAX_LECTURE_BYTES, type Lecture, type LectureProgress } from '../../shared/lectures';
import { useZenos } from '../context/ZenosContext';
import { useDanteStatus } from '../hooks/useDanteStatus';
import { useLectureRecorder } from '../hooks/useLectureRecorder';
import { processLectureAudio, disposeLectureSession, type LectureSession } from '../lib/lectureProcessing';
import { PageHeader, EmptyState, Modal, btn, card, input } from '../components/ui/kit';
import LectureStudy from '../components/LectureStudy';
export default function Lectures(){
 const {state,user,isOffline,getAuthToken,lecturesLoading,lecturesError,refreshLectures,loadLecture,saveLecture}=useZenos();
 const reduced=useReducedMotion();const resultArea=useRef<HTMLDivElement>(null);const [discard,setDiscard]=useState(false);
 const status=useDanteStatus();const [file,setFile]=useState<File|null>(null);const [title,setTitle]=useState('');const [language,setLanguage]=useState('');
 const [busy,setBusy]=useState(false);const [progress,setProgress]=useState<LectureProgress|null>(null);const [error,setError]=useState('');const [selected,setSelected]=useState('');const [draft,setDraft]=useState<Lecture|null>(null);
 const session=useRef<LectureSession>({});const controller=useRef<AbortController|null>(null);const running=useRef(false);const upload=useRef<HTMLInputElement>(null);
 const choose=(audio:File)=>{
  if(running.current||draft)return;
  void disposeLectureSession(session.current);session.current={};setDraft(null);setError('');setProgress(null);
  if(!audio.size||audio.size>MAX_LECTURE_BYTES){setError('Choose audio up to 60 minutes and under 1 GB.');return;}
  setFile(audio);setTitle(Array.from(audio.name.replace(/\.[^.]+$/,'')||'Lecture').slice(0,200).join(''));
 };
 const recorder=useLectureRecorder(choose,`${user?.id}:${isOffline}`);
 const [audioUrl,setAudioUrl]=useState('');
 useEffect(()=>{if(!file){setAudioUrl('');return;}const url=URL.createObjectURL(file);setAudioUrl(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>{setFile(null);setDraft(null);setSelected('');setError('');setProgress(null);setBusy(false);return()=>{controller.current?.abort();controller.current=null;running.current=false;const old=session.current;session.current={};void disposeLectureSession(old);};},[user?.id,isOffline]);
 useEffect(()=>{if(selected||draft)resultArea.current?.scrollIntoView?.({behavior:reduced?'auto':'smooth',block:'start'});},[selected,draft?.id,reduced]);
 const lecture=draft||(state.lectures||[]).find(row=>row.id===selected);
 useEffect(()=>{if(!selected||draft)return;let active=true;setError('');void loadLecture(selected).catch(()=>{if(active)setError('Could not open this lecture. Please select it again.');});return()=>{active=false;};},[selected,loadLecture]);
 const cancel=()=>{controller.current?.abort();controller.current=null;running.current=false;setBusy(false);setProgress(null);setError('');const old=session.current;session.current={};void disposeLectureSession(old);};
 const process=async()=>{
  if(!file||running.current)return;running.current=true;setBusy(true);setError('');const abort=new AbortController();controller.current=abort;const activeSession=session.current;
  try{
   const result=await processLectureAudio({file,title,language,session:activeSession,getToken:getAuthToken,signal:abort.signal,progress:value=>{if(!abort.signal.aborted)setProgress(value);}});
   if(abort.signal.aborted)return;setDraft(result);setProgress({stage:'saving',message:'Saving your lecture…'});
   const saved=await saveLecture(result);if(abort.signal.aborted)return;
   setSelected(saved.id);setDraft(null);setFile(null);setProgress(null);await disposeLectureSession(activeSession);
  }catch(failure){if(!abort.signal.aborted)setError(failure instanceof Error?failure.message:'Lecture processing failed. Please try again.');}
  finally{if(controller.current===abort){controller.current=null;running.current=false;setBusy(false);}}
 };
 const retrySave=async()=>{if(!draft||running.current)return;running.current=true;setBusy(true);setError('');try{const saved=await saveLecture(draft);setSelected(saved.id);setDraft(null);setFile(null);setProgress(null);await disposeLectureSession(session.current);}catch{setError('Notes are ready but could not be saved. Try saving again.');}finally{running.current=false;setBusy(false);}};
 const blocked=!status||!status.ready||!status.stt||(status.authRequired&&isOffline);
 return <div className="min-w-0">
  <PageHeader title="Lectures" subtitle="Record, transcribe and turn a lecture into study notes."/>
  <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
   <div className="min-w-0 space-y-5">
    <section className={`${card} p-5 space-y-4`} aria-label="New lecture">
     <h2 className="font-semibold">New lecture</h2>
     <p className="text-sm text-on-surface-variant">Up to 60 minutes and 1 GB. Audio goes to your configured transcription provider; text goes to your AI provider. Only the transcript and notes are saved.</p>
     <div className="flex flex-wrap gap-2">
      <button className={recorder.recording?btn.danger:btn.primary} disabled={busy||recorder.starting||!!draft} onClick={()=>recorder.recording?recorder.stop():void recorder.start()}>{recorder.recording?'Stop recording':recorder.starting?'Opening microphone…':'Record lecture'}</button>
      <button className={btn.secondary} disabled={busy||recorder.recording||recorder.starting||!!draft} onClick={()=>upload.current?.click()}>Upload audio</button>
      <input ref={upload} type="file" accept="audio/*,.m4a,.webm,.ogg,.wav,.mp3,.flac" className="sr-only" aria-label="Upload lecture audio" disabled={busy||recorder.recording||!!draft} onChange={event=>{const audio=event.target.files?.[0];if(audio)choose(audio);event.target.value='';}}/>
     </div>
     {recorder.recording&&<p role="status" className="text-primary font-medium">Recording {Math.floor(recorder.elapsed/60)}:{String(recorder.elapsed%60).padStart(2,'0')} / 60:00</p>}
     {recorder.error&&<p role="alert" className="text-error text-sm">{recorder.error}</p>}
     {file&&<>
      <p className="text-sm break-all">{file.name} · {(file.size/1_000_000).toFixed(1)} MB</p>
      {audioUrl&&<audio controls src={audioUrl} className="w-full"/>}
      <a href={audioUrl} download={file.name} className="text-primary text-sm underline">Download audio</a>
      <label className="block text-sm">Lecture title<input className={`${input} mt-1`} value={title} maxLength={200} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
      <label className="block text-sm">Transcription language<select className={`${input} mt-1`} value={language} disabled={busy} onChange={event=>setLanguage(event.target.value)}><option value="">Detect automatically</option><option value="en">English</option><option value="pl">Polski</option><option value="de">Deutsch</option><option value="es">Español</option><option value="fr">Français</option><option value="uk">Українська</option></select></label>
      <p className="text-xs text-on-surface-variant">Keep this page open while recording and processing. Download a recording first if you want to keep the original audio.</p>
      {!draft&&<button className={`${btn.solid} w-full`} disabled={busy||recorder.recording||blocked||!title.trim()} onClick={()=>void process()}>{session.current.job?'Retry processing':'Process lecture'}</button>}
     </>}
     {blocked&&<p className="text-xs text-on-surface-variant">{status?.authRequired&&isOffline?'Sign in to process lectures on this server.':'Processing needs transcription and an AI provider configured on the server.'}</p>}
     {busy&&progress&&<div role="status" aria-live="polite" className="space-y-2"><p className="text-sm">{progress.message}</p><progress className="w-full accent-primary" aria-label="Lecture processing progress" max={progress.total||1} value={progress.total?progress.completed:undefined}/></div>}
     {busy&&!draft&&<button className={btn.secondary} onClick={cancel}>Cancel processing</button>}
     {error&&<p role="alert" className="text-error text-sm break-words">{error}</p>}
    </section>
    <section className={`${card} p-5 space-y-3`} aria-label="Saved lectures"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Saved lectures</h2><button className={`${btn.ghost} text-xs`} disabled={lecturesLoading} onClick={()=>void refreshLectures()}>Refresh</button></div>
     {lecturesLoading&&<p className="text-sm text-on-surface-variant">Loading lectures…</p>}{lecturesError&&<p role="alert" className="text-error text-sm">{lecturesError}</p>}
     <ul className="space-y-2">{(state.lectures||[]).map(item=><li key={item.id}><button className={`w-full rounded-lg p-3 text-left transition-colors ${selected===item.id?'bg-primary-container text-on-primary-container':'bg-surface-container-low text-on-surface hover:bg-surface-container'}`} onClick={()=>{if(!busy&&!draft)setSelected(item.id);}} disabled={busy||!!draft}><span className="block break-words">{item.title}</span><span className="block text-xs mt-1 opacity-70">{Math.ceil(item.durationSeconds/60)} min · {item.flashcards.filter(c=>c.known).length}/10 known</span></button></li>)}</ul>
     {!state.lectures?.length&&!lecturesLoading&&<p className="text-sm text-on-surface-variant">Your completed lectures will appear here.</p>}
    </section>
   </div>
   <div ref={resultArea} className="min-w-0 scroll-mt-24">{draft&&<div className={`${card} p-4 mb-4 space-y-3`}><p className="text-sm text-on-surface-variant">{busy?'Saving your notes…':'Saving was not confirmed. Retry saving to keep these notes.'}</p><div className="flex flex-wrap gap-2"><button className={btn.solid} disabled={busy} onClick={()=>void retrySave()}>Retry saving notes</button><button className={btn.secondary} disabled={busy} onClick={()=>setDiscard(true)}>Discard draft</button></div></div>}{lecture?<LectureStudy lecture={lecture} unsaved={!!draft}/>:<EmptyState icon="school" title="Turn a lecture into a study guide" text="Record or upload audio to get a summary, key points, 10 flashcards and action items."/>}</div>
  </div>
  <Modal open={discard} onClose={()=>setDiscard(false)} title="Discard this draft?" footer={<><button className={btn.secondary} onClick={()=>setDiscard(false)}>Cancel</button><button className={btn.danger} onClick={()=>{cancel();setDraft(null);setDiscard(false);}}>Discard draft</button></>}><p>If the lecture was already saved, it will remain in your library. Otherwise, you will need to process the audio again.</p></Modal>
 </div>;
}
