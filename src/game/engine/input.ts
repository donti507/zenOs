import type {Position} from '../templates/village';
import {normalizeVector} from '../systems/movement';
const movement=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight']);
/** Scoped to the focusable viewport; never steals keyboard input from app forms/modals. */
export function bindKeyboard(host:HTMLElement,send:(v:Position)=>void,pause:()=>void,interact:()=>void=()=>{}){
 const held=new Set<string>();
 const update=()=>send(normalizeVector(Number(held.has('KeyD')||held.has('ArrowRight'))-Number(held.has('KeyA')||held.has('ArrowLeft')),Number(held.has('KeyS')||held.has('ArrowDown'))-Number(held.has('KeyW')||held.has('ArrowUp'))));
 const down=(event:KeyboardEvent)=>{if(event.target!==host||event.ctrlKey||event.altKey||event.metaKey)return;if(event.code==='Escape'){event.preventDefault();event.stopPropagation();if(!event.repeat)pause();return;}if(event.code==='KeyE'||event.code==='Space'){event.preventDefault();if(!event.repeat){clear();interact();}return;}if(movement.has(event.code)){event.preventDefault();held.add(event.code);update();}};
 const up=(event:KeyboardEvent)=>{if(held.delete(event.code))update();};
 const clear=()=>{held.clear();send({x:0,y:0});};
 host.addEventListener('keydown',down);window.addEventListener('keyup',up);host.addEventListener('blur',clear);window.addEventListener('blur',clear);
 return()=>{clear();host.removeEventListener('keydown',down);window.removeEventListener('keyup',up);host.removeEventListener('blur',clear);window.removeEventListener('blur',clear);};
}
