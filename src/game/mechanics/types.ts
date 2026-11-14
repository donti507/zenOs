import type {AdventureSpec} from '../spec';
export type Puzzle=AdventureSpec['missions'][number]['puzzle'];
export type GatePuzzle=Extract<Puzzle,{type:'gate'}>;
export type SequencePuzzle=Extract<Puzzle,{type:'sequence'}>;
export type MatchPuzzle=Extract<Puzzle,{type:'match'}>;
export type PuzzleAnswer={type:'gate';value:string|number}|{type:'sequence';order:number[]}|{type:'match';pairs:[number,number][]};
export type CheckResult={correct:boolean;code:'correct'|'incorrect'|'invalid';firstError?:number;matched?:number};
export type PuzzleStats={attempts:number;wrongAttempts:number;hintLevel:number};
export const emptyPuzzleStats=():PuzzleStats=>({attempts:0,wrongAttempts:0,hintLevel:0});
export function maxHintLevel(stats:PuzzleStats){return Math.min(3,Math.max(1,stats.wrongAttempts+1));}
export const invalidAnswer=():CheckResult=>({correct:false,code:'invalid'});
export function isPermutation(value:unknown,size:number):value is number[]{return Array.isArray(value)&&value.length===size&&new Set(value).size===size&&value.every(n=>Number.isInteger(n)&&n>=0&&n<size);}
/** Copy a bounded public attempt; unknown fields, malformed and incomplete submissions fail closed. */
export function parsePuzzleAnswer(puzzle:Puzzle,input:unknown):PuzzleAnswer|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;const raw=input as Record<string,unknown>;
 const field=puzzle.type==='gate'?'value':puzzle.type==='sequence'?'order':'pairs';
 if(raw.type!==puzzle.type||Object.keys(raw).length!==2||!Object.hasOwn(raw,'type')||!Object.hasOwn(raw,field))return null;
 if(puzzle.type==='gate'){
  const v=raw.value;if(puzzle.input==='choice')return Number.isInteger(v)&&Number(v)>=0&&Number(v)<(puzzle.choices?.length||0)?{type:'gate',value:v as number}:null;
  return typeof v==='string'&&v.trim().length>0&&v.length<=200?{type:'gate',value:v}:puzzle.input==='number'&&typeof v==='number'&&Number.isFinite(v)?{type:'gate',value:v}:null;
 }
 if(puzzle.type==='sequence')return isPermutation(raw.order,puzzle.items.length)?{type:'sequence',order:[...raw.order]}:null;
 if(!Array.isArray(raw.pairs)||raw.pairs.length!==puzzle.left.length)return null;
 const pairs=raw.pairs;if(!pairs.every(pair=>Array.isArray(pair)&&pair.length===2))return null;
 return isPermutation(pairs.map(p=>p[0]),puzzle.left.length)&&isPermutation(pairs.map(p=>p[1]),puzzle.right.length)?{type:'match',pairs:pairs.map(p=>[p[0],p[1]])}:null;
}
