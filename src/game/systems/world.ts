import type {AdventureSpec} from '../spec';
import type {Position} from '../templates/village';
import {canStand} from '../templates/village';
import {unlockedGates,type QuestProgress} from './quest';
export const GATE_AREAS={
 'east-gate':{x:9.5,y:4.5,width:4,height:5,entrance:{x:9.5,y:7}},
 'archive-gate':{x:.5,y:.5,width:5,height:2,entrance:{x:5.5,y:1.5}},
 'observatory-gate':{x:8.5,y:11.5,width:5,height:2,entrance:{x:8.5,y:12.5}},
} as const;
export function activeGates(spec:AdventureSpec){return [...new Set(spec.missions.flatMap(m=>m.unlocks?[m.unlocks.gateSlot]:[]))];}
export function insideArea(p:Position,area:typeof GATE_AREAS[keyof typeof GATE_AREAS],radius=0){return p.x+radius>area.x&&p.x-radius<area.x+area.width&&p.y+radius>area.y&&p.y-radius<area.y+area.height;}
export function canEnter(spec:AdventureSpec,progress:QuestProgress,p:Position){
 if(!canStand(p))return false;const open=unlockedGates(spec,progress);return activeGates(spec).every(gate=>open.includes(gate)||!insideArea(p,GATE_AREAS[gate],.23));
}
