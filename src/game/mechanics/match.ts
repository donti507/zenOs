import {isPermutation,invalidAnswer,type CheckResult} from './types';
export type Cell={x:number;y:number};
export function validateMatch(input:unknown,key:readonly (readonly [number,number])[],difficulty:1|2|3=1):CheckResult{
 const size=key.length;if(size<3||size>6||!isPermutation(key.map(p=>p[0]),size)||!isPermutation(key.map(p=>p[1]),size))throw new Error('Invalid verifier key.');
 if(!Array.isArray(input)||input.length!==size||!input.every(p=>Array.isArray(p)&&p.length===2)||!isPermutation(input.map(p=>p[0]),size)||!isPermutation(input.map(p=>p[1]),size))return invalidAnswer();
 const expected=new Map(key),matched=input.filter(([left,right])=>expected.get(left)===right).length,correct=matched===size;
 return {correct,code:correct?'correct':'incorrect',...(difficulty<3?{matched}: {})};
}
export function moveCarrier(cell:Cell,dx:number,dy:number,size:number):Cell{
 const height=2*size+1;return {x:Math.max(0,Math.min(6,cell.x+Math.sign(dx))),y:Math.max(0,Math.min(height-1,cell.y+Math.sign(dy)))};
}
export function deliveryRoute(from:Cell,to:Cell):Cell[]{
 const route:Cell[]=[];let p={...from};while(p.x!==to.x||p.y!==to.y){p=p.x!==to.x?{x:p.x+Math.sign(to.x-p.x),y:p.y}:{x:p.x,y:p.y+Math.sign(to.y-p.y)};route.push(p);if(route.length>20)throw new Error('Invalid delivery route.');}return route;
}
export function nearStation(cell:Cell,column:number,index:number){return Math.abs(cell.x-column)+Math.abs(cell.y-(2*index+1))<=1;}
export function placePair(pairs:readonly [number,number][],carried:number|null,pedestal:number,size:number):[number,number][]{
 if(carried===null||!Number.isInteger(carried)||carried<0||carried>=size||!Number.isInteger(pedestal)||pedestal<0||pedestal>=size||pairs.some(p=>p[0]===carried||p[1]===pedestal))return pairs.map(p=>[...p]);return [...pairs.map(p=>[...p] as [number,number]),[carried,pedestal]];
}
