import {isPermutation,invalidAnswer,type CheckResult} from './types';
export function validateSequence(input:unknown,order:readonly number[],difficulty:1|2|3=1):CheckResult{
 if(!isPermutation([...order],order.length)||order.length<3||order.length>8)throw new Error('Invalid verifier key.');
 if(!isPermutation(input,order.length))return invalidAnswer();const firstError=input.findIndex((id,i)=>id!==order[i]),correct=firstError===-1;
 return {correct,code:correct?'correct':'incorrect',...(!correct&&difficulty===1?{firstError}: {})};
}
export function activateSwitch(selected:readonly number[],index:number,size:number){return Number.isInteger(index)&&index>=0&&index<size&&!selected.includes(index)?[...selected,index]:[...selected];}
