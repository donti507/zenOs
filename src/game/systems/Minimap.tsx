import type {AdventureSpec} from '../spec';
import {VILLAGE,type Position} from '../templates/village';
import {activeGates,GATE_AREAS} from './world';
import {unlockedGates,type QuestProgress} from './quest';
import {placedNpcs,npcMarker} from './npc';
import {tr,useUiLanguage} from '../../i18n';
const point=(p:Position)=>({x:60+(p.x-p.y)*3.5,y:7+(p.x+p.y)*1.75});
const polygon=(corners:Position[])=>corners.map(p=>{const v=point(p);return `${v.x},${v.y}`;}).join(' ');
export default function Minimap({spec,position,progress}:{spec:AdventureSpec;position:Position;progress:QuestProgress}){
 useUiLanguage();const player=point(position),open=unlockedGates(spec,progress);
 return <div className="rounded-lg bg-surface-container-lowest/95 p-1 shadow-soft ring-1 ring-outline-variant pointer-events-none"><svg role="img" aria-label={tr('Village minimap: player, characters and gated areas')} viewBox="0 0 120 64" className="w-28 h-16"><polygon points="60,7 109,31.5 60,56 11,31.5" className="fill-primary-container stroke-outline-variant"/>{activeGates(spec).map(id=>{const a=GATE_AREAS[id];return <polygon key={id} points={polygon([{x:a.x,y:a.y},{x:a.x+a.width,y:a.y},{x:a.x+a.width,y:a.y+a.height},{x:a.x,y:a.y+a.height}])} className={open.includes(id)?'fill-success-container stroke-success':'fill-warning-container stroke-warning'} strokeWidth=".8"/>;})}{VILLAGE.buildings.map((b,i)=>{const p=point(b);return <rect key={i} x={p.x-3} y={p.y-2} width="6" height="4" className="fill-on-surface-variant"/>;})}{placedNpcs(spec).map(npc=>{const p=point(npc.position);return <circle key={npc.id} cx={p.x} cy={p.y} r="2.3" className={npcMarker(spec,progress,npc.id)==='locked'?'fill-outline':'fill-warning stroke-on-surface'}/>;})}<circle cx={player.x} cy={player.y} r="2.6" className="fill-primary stroke-on-primary" strokeWidth="1"/></svg><p className="text-[10px] text-center text-on-surface-variant">{tr('Minimap')}</p></div>;
}
