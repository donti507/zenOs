import {createPortal} from 'react-dom';
import {useEffect,useRef,useState,useCallback} from 'react';
import {useReducedMotion} from 'motion/react';
import {useZenos} from '../context/ZenosContext';
import {tr,useUiLanguage} from '../i18n';
import {btn,Modal} from '../components/ui/kit';
import type {AdventureSpec} from './spec';
import type {EngineHandle} from './engine/boot';
import type {Position} from './templates/village';
import {mountAdventure} from './runtime';
import {bindKeyboard} from './engine/input';
import TouchJoystick from './TouchJoystick';
export default function AdventureViewport({spec}:{spec:AdventureSpec}){
 useUiLanguage();const {adventureSettings,setAdventureSettings,liveOpen,showModal}=useZenos();const systemReduce=!!useReducedMotion();
 const reducedMotion=systemReduce||adventureSettings.reducedMotion;
 const host=useRef<HTMLDivElement>(null),engine=useRef<EngineHandle|null>(null),position=useRef<Position|undefined>(undefined),pausedRef=useRef(false);
 const [paused,setPaused]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[location,setLocation]=useState('square');
 const pause=useCallback(()=>{pausedRef.current=true;engine.current?.setPaused(true);setPaused(true);},[]);
 const resume=()=>{if(liveOpen||showModal)return;pausedRef.current=false;engine.current?.setPaused(false);setPaused(false);host.current?.focus({preventScroll:true});};
 useEffect(()=>{
  let active=true;const controller=new AbortController();setReady(false);setError(false);
  const stopInput=bindKeyboard(host.current!,vector=>{if(!pausedRef.current)engine.current?.setMovement(vector);},pause);
  const hide=()=>{if(document.hidden)pause();};window.addEventListener('blur',pause);document.addEventListener('visibilitychange',hide);
  void mountAdventure({parent:host.current!,spec,signal:controller.signal,position:position.current,lowPerformance:adventureSettings.lowPerformance,reducedMotion,
   onReady:()=>{if(active){setReady(true);if(!pausedRef.current)host.current?.focus({preventScroll:true});}},onFailure:()=>{if(active){setError(true);pause();}},
   onPosition:p=>{if(active){position.current=p;host.current?.setAttribute('data-player-x',p.x.toFixed(3));host.current?.setAttribute('data-player-y',p.y.toFixed(3));setLocation(Math.abs(p.x-7)<1.5&&Math.abs(p.y-7)<2.5?'square':'path');}},
  }).then(handle=>{if(!active){handle?.destroy();return;}engine.current=handle;handle?.setPaused(pausedRef.current);}).catch(()=>{if(active){setError(true);pause();}});
  return()=>{active=false;controller.abort();stopInput();window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',hide);if(engine.current){position.current=engine.current.getPosition();engine.current.destroy();engine.current=null;}};
 },[spec,adventureSettings.lowPerformance,reducedMotion,attempt,pause]);
 useEffect(()=>{if(liveOpen||showModal)pause();},[liveOpen,showModal,pause]);
 return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-on-surface-variant" aria-live="polite">{location==='square'?tr('Village square'):tr('Village path')}</p><button className={btn.secondary+' min-h-11'} onClick={pause}>{tr('Pause and settings')}</button></div>
 <div className="relative rounded-xl overflow-hidden bg-surface-container-low ring-1 ring-outline-variant"><div ref={host} tabIndex={0} aria-label={tr('Adventure world. Use WASD or arrow keys to walk. Escape pauses.')} aria-describedby="adventure-controls" className="h-[min(52dvh,520px)] min-h-72 w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onPointerDown={()=>{if(!pausedRef.current)host.current?.focus({preventScroll:true});}}/>{!ready&&!error&&<p role="status" className="absolute inset-0 flex items-center justify-center bg-surface-container-low text-on-surface-variant">{tr('Loading adventure world…')}</p>}{error&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-5 bg-surface-container-low"><p role="alert" className="text-error">{tr('The world could not load. Please try again.')}</p><button className={btn.primary} onClick={()=>{pausedRef.current=false;setPaused(false);setAttempt(v=>v+1);}}>{tr('Retry')}</button></div>}{ready&&!error&&<div className="absolute bottom-3 left-3"><TouchJoystick compact disabled={paused} onMove={vector=>{if(!pausedRef.current)engine.current?.setMovement(vector);}}/></div>}</div>
 <div><p id="adventure-controls" className="text-sm text-on-surface-variant">{tr('Click the world, then use WASD or arrow keys. Escape pauses. Touch: drag the joystick.')}</p></div>
 {createPortal(<Modal open={paused&&!error} onClose={resume} title={tr('Adventure paused')} footer={<button className={btn.primary+' min-h-11'} disabled={!!liveOpen||!!showModal} onClick={resume}>{tr('Resume exploring')}</button>}><p className="text-on-surface-variant">{tr('Your explorer stays here while you take a break.')}</p><label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={adventureSettings.lowPerformance} onChange={e=>setAdventureSettings({lowPerformance:e.target.checked})}/><span>{tr('Low-performance mode')}<span className="block text-sm text-on-surface-variant">{tr('Lower resolution, 30 FPS, no particles.')}</span></span></label><label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={reducedMotion} disabled={systemReduce} onChange={e=>setAdventureSettings({reducedMotion:e.target.checked})}/><span>{tr('Reduced motion')}<span className="block text-sm text-on-surface-variant">{systemReduce?tr('Enabled by your device preference.'):tr('No walk animation or camera easing.')}</span></span></label></Modal>,document.body)}</div>;
}
