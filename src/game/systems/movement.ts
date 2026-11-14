import { canStand, fromWorld, toWorld, type Position } from '../templates/village';
export type Direction='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
export function normalizeVector(x:number,y:number):Position {const size=Math.hypot(x,y);return size>.01?{x:x/Math.max(1,size),y:y/Math.max(1,size)}:{x:0,y:0};}
export function facing(v:Position):Direction {const sectors:Direction[]=['e','se','s','sw','w','nw','n','ne'];return sectors[(Math.round(Math.atan2(v.y,v.x)/(Math.PI/4))+8)%8];}
/** Screen-space movement, capped frame time, foot-radius collisions and wall sliding. */
export function movePlayer(position:Position,vector:Position,deltaMs:number):Position {
 const v=normalizeVector(vector.x,vector.y),step=140*Math.min(Math.max(deltaMs,0),40)/1000,p=toWorld(position);
 const x=fromWorld({x:p.x+v.x*step,y:p.y});if(canStand(x))p.x+=v.x*step;
 const y=fromWorld({x:p.x,y:p.y+v.y*step});if(canStand(y))p.y+=v.y*step;
 return fromWorld(p);
}
