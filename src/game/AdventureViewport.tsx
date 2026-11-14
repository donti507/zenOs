import {createPortal} from 'react-dom';
import {useEffect,useMemo,useRef,useState,useCallback} from 'react';
import {useReducedMotion} from 'motion/react';
import {useZenos} from '../context/ZenosContext';
import {tr,useUiLanguage} from '../i18n';
import {btn,Modal} from '../components/ui/kit';
import type {AdventureSpec} from './spec';
import type {EngineHandle} from './engine/boot';
import {VILLAGE,type Position} from './templates/village';
import {mountAdventure} from './runtime';
import {bindKeyboard} from './engine/input';
import TouchJoystick from './TouchJoystick';
import {normalizeProgress,questStatus} from './systems/quest';
import {nearbyNpc,npcInRange} from './systems/npc';
import DialogueBox from './systems/DialogueBox';
import Hud from './systems/Hud';
import Minimap from './systems/Minimap';
import PuzzleOverlay from './mechanics/PuzzleOverlay';
import MissionComplete from './systems/MissionComplete';
export default function AdventureViewport({spec,adventureId='lost-binary-kingdom'}:{spec:AdventureSpec;adventureId?:string}){
 useUiLanguage();const {adventureSettings,setAdventureSettings,liveOpen,showModal,adventureProgress,advanceAdventureQuest}=useZenos();const systemReduce=!!useReducedMotion();
 const reducedMotion=systemReduce||adventureSettings.reducedMotion;
 const saved=adventureProgress?.[adventureId],progress=useMemo(()=>normalizeProgress(spec,saved),[spec,saved]),progressRef=useRef(progress);progressRef.current=progress;
 const host=useRef<HTMLDivElement>(null),engine=useRef<EngineHandle|null>(null),position=useRef<Position|undefined>(undefined),pausedRef=useRef(false),dialogueRef=useRef<string|null>(null),interactRef=useRef<(id?:string)=>void>(()=>{});
 const tap=useRef<{id:number;x:number;y:number;npcId:string|null}|null>(null);
 const [paused,setPaused]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[playerPosition,setPlayerPosition]=useState<Position>({...VILLAGE.spawn}),[dialogueNpc,setDialogueNpc]=useState<string|null>(null);
 const [puzzleMission,setPuzzleMission]=useState<string|null>(null),solvedNotice=useRef<{title:string;xp:number;unlocked:number}|null>(null);
 const [notice,setNotice]=useState<{title:string;xp:number;unlocked:number;serial:number}|null>(null),serial=useRef(0);
 const pause=useCallback(()=>{pausedRef.current=true;dialogueRef.current=null;setDialogueNpc(null);setPuzzleMission(null);engine.current?.setPaused(true);setPaused(true);},[]);
 const resume=()=>{if(liveOpen||showModal)return;if(solvedNotice.current){setNotice({...solvedNotice.current,serial:++serial.current});solvedNotice.current=null;}pausedRef.current=false;engine.current?.setPaused(false);setPaused(false);host.current?.focus({preventScroll:true});};
 const closeDialogue=()=>{dialogueRef.current=null;setDialogueNpc(null);if(!paused)resume();};
 interactRef.current=(id?:string)=>{
  if(!ready||pausedRef.current||liveOpen||showModal||error)return;
  const p=engine.current?.getPosition()??position.current??VILLAGE.spawn,npcId=id??nearbyNpc(spec,p,progressRef.current)?.id;
  if(!npcId||!npcInRange(spec,p,npcId,progressRef.current))return;
  pausedRef.current=true;engine.current?.setPaused(true);dialogueRef.current=npcId;setDialogueNpc(npcId);
 };
 const onQuest=(type:'accept'|'puzzle',missionId:string)=>{
  const npcId=dialogueRef.current,p=engine.current?.getPosition()??position.current??VILLAGE.spawn;
  if(liveOpen||showModal||!npcId||!npcInRange(spec,p,npcId,progressRef.current)||!spec.missions.some(m=>m.id===missionId&&m.npcId===npcId))return;
  if(type==='puzzle'){if(questStatus(spec,progressRef.current,missionId)!=='active')return;dialogueRef.current=null;setDialogueNpc(null);setPuzzleMission(missionId);return;}
  const result=advanceAdventureQuest(adventureId,{type:'accept',missionId});
  if(result)engine.current?.setProgress?.(result.progress);
  closeDialogue();
 };
 const onSolved=(result:{progress:import('./systems/quest').QuestProgress;xpGranted:number;newlyUnlocked:string[];missionId:string|null})=>{
  engine.current?.setProgress?.(result.progress);const mission=spec.missions.find(m=>m.id===result.missionId);
  if(mission&&result.xpGranted>0)solvedNotice.current={title:mission.title,xp:result.xpGranted,unlocked:result.newlyUnlocked.length};
 };
 const closePuzzle=()=>{setPuzzleMission(null);resume();};
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(null),5000);return()=>window.clearTimeout(timer);},[notice?.serial]);
 useEffect(()=>{engine.current?.setProgress?.(progress);},[progress]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setReady(false);setError(false);
  const stopInput=bindKeyboard(host.current!,vector=>{if(!pausedRef.current)engine.current?.setMovement(vector);},pause,()=>interactRef.current());
  const hide=()=>{if(document.hidden)pause();};window.addEventListener('blur',pause);document.addEventListener('visibilitychange',hide);
  void mountAdventure({parent:host.current!,spec,progress:progressRef.current,signal:controller.signal,position:position.current,lowPerformance:adventureSettings.lowPerformance,reducedMotion,
   onReady:()=>{if(active){setReady(true);if(!pausedRef.current)host.current?.focus({preventScroll:true});}},onFailure:()=>{if(active){setError(true);pause();}},
   onPosition:p=>{if(active){position.current=p;host.current?.setAttribute('data-player-x',p.x.toFixed(3));host.current?.setAttribute('data-player-y',p.y.toFixed(3));setPlayerPosition(p);}},
  }).then(handle=>{if(!active){handle?.destroy();return;}engine.current=handle;handle?.setProgress?.(progressRef.current);handle?.setPaused(pausedRef.current);}).catch(()=>{if(active){setError(true);pause();}});
  return()=>{active=false;controller.abort();stopInput();window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',hide);if(engine.current){position.current=engine.current.getPosition();engine.current.destroy();engine.current=null;}};
 },[spec,adventureSettings.lowPerformance,reducedMotion,attempt,pause]);
 useEffect(()=>{if(liveOpen||showModal)pause();},[liveOpen,showModal,pause]);
 const nearest=nearbyNpc(spec,playerPosition,progress);
 return <div className="space-y-3"><Hud spec={spec} progress={progress}/><div className="flex items-center justify-between gap-3"><p className="text-xs text-on-surface-variant">{tr('E / Space / tap to talk when near')}</p><button className={btn.secondary+' min-h-11'} onClick={pause}>{tr('Pause and settings')}</button></div>
 <div className="relative rounded-xl overflow-hidden bg-surface-container-low ring-1 ring-outline-variant"><div ref={host} tabIndex={0} aria-label={tr('Adventure world. Use WASD or arrow keys to walk. Escape pauses.')} aria-describedby="adventure-controls" className="h-[min(42dvh,440px)] min-h-64 w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onPointerDown={event=>{
  if(pausedRef.current)return;host.current?.focus({preventScroll:true});const npcId=engine.current?.npcAt?.(event.clientX,event.clientY)??null;
  tap.current={id:event.pointerId,x:event.clientX,y:event.clientY,npcId};
  // Suppress touch compatibility mousedown: it would hit the newly opened modal backdrop.
  if(event.pointerType==='touch'&&npcId)event.preventDefault();
 }} onPointerCancel={()=>{tap.current=null;}} onPointerUp={event=>{
  const start=tap.current;tap.current=null;if(pausedRef.current||!start||start.id!==event.pointerId||!start.npcId||Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)return;
  const npcId=engine.current?.npcAt?.(event.clientX,event.clientY);if(npcId===start.npcId)interactRef.current(npcId);
 }}/>
 {!ready&&!error&&<p role="status" className="absolute inset-0 flex items-center justify-center bg-surface-container-low text-on-surface-variant">{tr('Loading adventure world…')}</p>}
 {error&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-5 bg-surface-container-low"><p role="alert" className="text-error">{tr('The world could not load. Please try again.')}</p><button className={btn.primary} onClick={()=>{pausedRef.current=false;setPaused(false);setAttempt(v=>v+1);}}>{tr('Retry')}</button></div>}
 {ready&&!error&&<><div className="absolute top-2 right-2"><Minimap spec={spec} position={playerPosition} progress={progress}/></div><div className="absolute bottom-3 left-3"><TouchJoystick compact disabled={paused||!!dialogueNpc||!!puzzleMission} onMove={vector=>{if(!pausedRef.current)engine.current?.setMovement(vector);}}/></div><button className={btn.primary+' absolute bottom-20 right-3 max-w-[52%] min-h-11 text-sm'} disabled={paused||!!dialogueNpc||!!puzzleMission||!nearest} onClick={()=>interactRef.current()}>{nearest?tr('Talk to {{0}}',nearest.name):tr('Move near a character')}</button></>}
 {notice&&<div key={notice.serial} className="absolute top-2 left-2 right-32 pointer-events-none"><MissionComplete title={notice.title} xp={notice.xp} unlocked={notice.unlocked} reducedMotion={reducedMotion||adventureSettings.lowPerformance}/></div>}
 </div><p id="adventure-controls" className="text-xs text-on-surface-variant">{tr('Walk with WASD, arrows or the joystick. Press E/Space or tap a nearby character to talk. Escape pauses.')}</p>

 {dialogueNpc&&!paused&&<div key={dialogueNpc}><DialogueBox spec={spec} npcId={dialogueNpc} progress={progress} reducedMotion={reducedMotion||adventureSettings.lowPerformance} onClose={closeDialogue} onQuest={onQuest}/></div>}
 {puzzleMission&&!paused&&<div key={puzzleMission}><PuzzleOverlay spec={spec} missionId={puzzleMission} adventureId={adventureId} reducedMotion={reducedMotion||adventureSettings.lowPerformance} onClose={closePuzzle} onSolved={onSolved}/></div>}
 {createPortal(<Modal open={paused&&!error} onClose={resume} title={tr('Adventure paused')} footer={<button className={btn.primary+' min-h-11'} disabled={!!liveOpen||!!showModal} onClick={resume}>{tr('Resume exploring')}</button>}><p className="text-on-surface-variant">{tr('Your explorer stays here while you take a break.')}</p><label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={adventureSettings.lowPerformance} onChange={e=>setAdventureSettings({lowPerformance:e.target.checked})}/><span>{tr('Low-performance mode')}<span className="block text-sm text-on-surface-variant">{tr('Lower resolution, 30 FPS, no particles.')}</span></span></label><label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={reducedMotion} disabled={systemReduce} onChange={e=>setAdventureSettings({reducedMotion:e.target.checked})}/><span>{tr('Reduced motion')}<span className="block text-sm text-on-surface-variant">{systemReduce?tr('Enabled by your device preference.'):tr('No walk animation or camera easing.')}</span></span></label></Modal>,document.body)}</div>;
}
