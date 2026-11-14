import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {tr,useUiLanguage} from '../i18n';
import {normalizeVector} from './systems/movement';
import type {Position} from './templates/village';
export default function TouchJoystick({onMove,disabled,compact=false}:{onMove:(v:Position)=>void;disabled:boolean;compact?:boolean}){
 useUiLanguage();const active=useRef<number|null>(null);const [knob,setKnob]=useState({x:0,y:0});
 useEffect(()=>{if(disabled){active.current=null;setKnob({x:0,y:0});onMove({x:0,y:0});}},[disabled]);
 const update=(event:PointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();const v=normalizeVector((event.clientX-rect.left-rect.width/2)/36,(event.clientY-rect.top-rect.height/2)/36);setKnob({x:v.x*26,y:v.y*26});onMove(v);};
 const release=(event:PointerEvent<HTMLDivElement>)=>{if(active.current!==event.pointerId)return;active.current=null;setKnob({x:0,y:0});onMove({x:0,y:0});};
 return <div role="group" aria-label={tr('Touch movement controls')} className="flex items-center gap-3"><div aria-label={tr('Drag to walk')} className={`relative h-28 w-28 shrink-0 rounded-full bg-surface-container-high ring-1 ring-outline-variant touch-none select-none ${disabled?'opacity-40':''}`} onPointerDown={event=>{if(disabled||active.current!==null)return;active.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);update(event);}} onPointerMove={event=>{if(!disabled&&active.current===event.pointerId)update(event);}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><span className="absolute inset-0 flex items-center justify-center text-on-surface-variant text-2xl" aria-hidden="true">✥</span><span className="absolute left-9 top-9 h-10 w-10 rounded-full bg-primary-container ring-2 ring-primary/30 shadow-soft" style={{transform:`translate(${knob.x}px, ${knob.y}px)`}}/></div><p className={compact?'sr-only':'text-sm text-on-surface-variant max-w-44'}>{tr('Drag to walk. Release to stop.')}</p></div>;
}
