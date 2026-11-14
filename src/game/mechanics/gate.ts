import type {GatePuzzle,CheckResult} from './types';
import {invalidAnswer} from './types';
/** Private verifier data. Never add these fields to the public puzzle schema. */
export type GateKey={kind:'number';value:number;tolerance?:number}|{kind:'text';value:string;normalize?:boolean}|{kind:'choice';index:number};
export function parseGateNumber(input:unknown):number|null{
 if(typeof input==='number')return Number.isFinite(input)?input:null;
 if(typeof input!=='string'||input.length>200)return null;const text=input.trim().replace(',','.');
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))return null;
 const value=Number(text);return Number.isFinite(value)?value:null;
}
export function normalizeGateText(value:string){return value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[łŁ]/g,'l').trim().replace(/\s+/gu,' ').toLowerCase();}
export function validateGate(puzzle:GatePuzzle,input:unknown,key:GateKey):CheckResult{
 if(!key||key.kind!==puzzle.input)throw new Error('Invalid verifier key.');let correct=false;
 if(key.kind==='number'){
  if(!Number.isFinite(key.value)||!Number.isFinite(key.tolerance??0)||(key.tolerance??0)<0)throw new Error('Invalid verifier key.');
  const value=parseGateNumber(input);if(value===null)return invalidAnswer();const tolerance=key.tolerance??0,rounding=tolerance>0?Number.EPSILON*Math.max(1,Math.abs(value),Math.abs(key.value))*4:0;
  correct=Math.abs(value-key.value)<=tolerance+rounding;
 }else if(key.kind==='text'){
  if(typeof key.value!=='string'||key.value.length>200||!key.value.trim()||(key.normalize!==false&&!normalizeGateText(key.value)))throw new Error('Invalid verifier key.');
  if(typeof input!=='string'||input.length>200||!input.trim())return invalidAnswer();if(key.normalize!==false&&!normalizeGateText(input))return invalidAnswer();correct=key.normalize===false?input===key.value:normalizeGateText(input)===normalizeGateText(key.value);
 }else{
  const size=puzzle.choices?.length||0;if(!Number.isInteger(key.index)||key.index<0||key.index>=size)throw new Error('Invalid verifier key.');
  if(!Number.isInteger(input)||Number(input)<0||Number(input)>=size)return invalidAnswer();correct=input===key.index;
 }
 return {correct,code:correct?'correct':'incorrect'};
}
