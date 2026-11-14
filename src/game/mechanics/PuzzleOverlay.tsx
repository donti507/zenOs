import {createPortal} from 'react-dom';
import {useEffect,useRef,useState} from 'react';
import {useZenos} from '../../context/ZenosContext';
import type {AdventureSpec} from '../spec';
import {Modal,btn} from '../../components/ui/kit';
import {tr,useUiLanguage} from '../../i18n';
import {emptyPuzzleStats,maxHintLevel,parsePuzzleAnswer,type CheckResult,type PuzzleAnswer} from './types';
import GateMechanic from './GateMechanic';
import SequenceMechanic from './SequenceMechanic';
import MatchMechanic from './MatchMechanic';
export default function PuzzleOverlay({spec,missionId,adventureId,reducedMotion,onClose,onSolved}:{spec:AdventureSpec;missionId:string;adventureId:string;reducedMotion:boolean;onClose:()=>void;onSolved:(result:{progress:import('../systems/quest').QuestProgress;xpGranted:number;newlyUnlocked:string[];missionId:string|null})=>void}){
 useUiLanguage();const {submitAdventurePuzzle,requestAdventureHint,adventurePuzzleStats}=useZenos();
 const mission=spec.missions.find(m=>m.id===missionId)!,puzzle=mission.puzzle,objective=spec.objectives.find(o=>o.id===mission.objectiveId)!,stats=adventurePuzzleStats?.[adventureId]?.[missionId]??emptyPuzzleStats();
 const misconception=spec.concepts.find(c=>objective.conceptIds.includes(c.id)&&c.misconception)?.misconception;
 const [answer,setAnswer]=useState<PuzzleAnswer|null>(null),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState<CheckResult|null>(null),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),active=useRef(true),solved=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();};},[]);
 const close=()=>{controller.current?.abort();onClose();};
 const check=async()=>{
  if(controller.current||solved.current||!parsePuzzleAnswer(puzzle,answer))return;
  const attempt=new AbortController();controller.current=attempt;setBusy(true);setError('');
  try{const result=await submitAdventurePuzzle(adventureId,missionId,answer,attempt.signal);if(!active.current||attempt.signal.aborted)return;
   if(!result){setError('This puzzle is no longer active. Reopen it from the character.');return;}setFeedback(result.check);
   if(result.check.correct){solved.current=true;onSolved(result);}
  }catch{if(active.current&&!attempt.signal.aborted)setError('Could not check this puzzle. Please try again.');}
  finally{if(controller.current===attempt)controller.current=null;if(active.current)setBusy(false);}
 };
 const update=(value:PuzzleAnswer)=>{if(!busy&&!solved.current){setAnswer(value);setFeedback(null);setError('');}};
 const disabled=busy||solved.current;
 const hint=()=>{if(!disabled)requestAdventureHint(adventureId,missionId);};
 const title=feedback?.correct?tr('Puzzle solved'):mission.title;
 return createPortal(<div onKeyDown={event=>{
  if(event.key==='Enter'&&(event.target as HTMLElement).tagName==='INPUT'&&puzzle.type==='gate'){event.preventDefault();void check();}
  if(event.key==='Tab'){
   const dialog=(event.currentTarget as HTMLElement).querySelector('[role=dialog]');const elements=[...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')||[])];const first=elements[0],last=elements[elements.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 }}><Modal open title={title} onClose={close} width={640} footer={<div className="flex flex-wrap gap-2 justify-end"><button className={btn.secondary} onClick={close}>{solved.current?tr('Continue exploring'):tr('Close puzzle')}</button>{!solved.current&&<button className={btn.primary} disabled={busy||!parsePuzzleAnswer(puzzle,answer)} onClick={()=>void check()}>{busy?tr('Checking answer…'):tr('Check answer')}</button>}</div>}>
 <div className="min-w-0 [overflow-wrap:anywhere] space-y-4"><div className="space-y-1"><p className="text-xs text-on-surface-variant">{tr('Sample puzzle · Local practice results only.')}</p><p className="text-sm font-medium">{tr('Learning objective: {{0}}',objective.text)}</p><p className="text-xs text-on-surface-variant">{puzzle.difficulty===1?tr('Difficulty 1 · Guided'):puzzle.difficulty===2?tr('Difficulty 2 · Standard'):tr('Difficulty 3 · Challenge')}</p><h3 className="font-semibold">{puzzle.prompt}</h3></div>
 {puzzle.type==='gate'?<GateMechanic puzzle={puzzle} answer={answer} onChange={update} disabled={disabled}/>:puzzle.type==='sequence'?<SequenceMechanic puzzle={puzzle} answer={answer} onChange={update} disabled={disabled}/>:<MatchMechanic puzzle={puzzle} answer={answer} onChange={update} disabled={disabled} reducedMotion={reducedMotion}/>}
 {feedback&&<div role="status" aria-live="polite" className={`rounded-lg p-3 space-y-1 ${feedback.correct?'bg-success-container text-on-surface':'bg-surface-container-low text-on-surface'}`}><p className="font-medium">{feedback.correct?tr('Correct — {{0}}',objective.text):feedback.code==='invalid'?tr('Enter a complete answer in the requested format.'):tr('Not correct yet. Try again.')}</p>{!feedback.correct&&misconception&&<p className="text-sm">{misconception}</p>}{feedback.firstError!==undefined&&<p className="text-sm">{tr('Check switch position {{0}}.',feedback.firstError+1)}</p>}{feedback.matched!==undefined&&!feedback.correct&&<p className="text-sm">{tr('{{0}} of {{1}} pairs are correct.',feedback.matched,puzzle.type==='match'?puzzle.left.length:0)}</p>}</div>}
 {error&&<p role="alert" className="text-error">{tr(error)}</p>}
 <section className="space-y-2" aria-label={tr('Three-step hints')}><div className="flex flex-wrap items-center gap-2 justify-between"><h3 className="text-sm font-semibold">{tr('Hints: nudge → explanation → worked example')}</h3><button className={btn.secondary} disabled={disabled||stats.hintLevel>=maxHintLevel(stats)} onClick={hint}>{stats.hintLevel===0?tr('Show nudge'):stats.hintLevel===1?tr('Show explanation'):tr('Show worked example')}</button></div><ol className="list-decimal pl-5 text-sm space-y-2">{puzzle.hints.slice(0,stats.hintLevel).map((hint,index)=><li key={index}>{hint}</li>)}</ol>{stats.hintLevel<3&&stats.hintLevel>=maxHintLevel(stats)&&<p className="text-xs text-on-surface-variant">{tr('The next hint unlocks after another incorrect attempt.')}</p>}<p className="text-xs text-on-surface-variant">{tr('Attempts: {{0}} · Hints used: {{1}}',stats.attempts,stats.hintLevel)}</p></section>
 </div></Modal></div>,document.body);
}
