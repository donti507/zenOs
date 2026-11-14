import type {GatePuzzle,PuzzleAnswer} from './types';
import {input as inputStyle} from '../../components/ui/kit';
import {tr,useUiLanguage} from '../../i18n';
export default function GateMechanic({puzzle,answer,onChange,disabled}:{puzzle:GatePuzzle;answer:PuzzleAnswer|null;onChange:(answer:PuzzleAnswer)=>void;disabled:boolean}){
 useUiLanguage();const value=answer?.type==='gate'?answer.value:'';
 if(puzzle.input==='choice')return <fieldset disabled={disabled} className="space-y-2"><legend className="text-sm font-medium mb-2">{tr('Choose an answer')}</legend>{puzzle.choices?.map((choice,index)=><label key={index} className="flex items-center gap-3 min-h-11 rounded-lg bg-surface-container-low px-3 py-2"><input type="radio" name="puzzle-choice" checked={value===index} onChange={()=>onChange({type:'gate',value:index})}/><span>{choice}</span></label>)}</fieldset>;
 return <label className="flex flex-col gap-2"><span className="text-sm font-medium">{puzzle.input==='number'?tr('Your numeric answer'):tr('Your answer')}</span><input className={inputStyle} value={value} disabled={disabled} maxLength={200} inputMode={puzzle.input==='number'?'decimal':'text'} autoComplete="off" spellCheck={false} onChange={event=>onChange({type:'gate',value:event.target.value})}/>{puzzle.input==='number'&&<span className="text-xs text-on-surface-variant">{tr('Use a decimal point or comma. Do not add thousands separators.')}</span>}</label>;
}
