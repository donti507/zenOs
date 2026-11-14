// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import SequenceMechanic from '../mechanics/SequenceMechanic';
import MatchMechanic from '../mechanics/MatchMechanic';
import GateMechanic from '../mechanics/GateMechanic';
import type {PuzzleAnswer,GatePuzzle} from '../mechanics/types';
import {lostBinaryKingdom as spec} from '../samples/lost-binary-kingdom';
let root:Root,host:HTMLDivElement,last:PuzzleAnswer|null;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);last=null;});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(label))!;
it('activates switches by user order with undo/reset and no correct order embedded in the controls',async()=>{
 const puzzle=spec.missions[0].puzzle;if(puzzle.type!=='sequence')throw Error();function Harness(){const [answer,set]=useState<PuzzleAnswer|null>(null);return <SequenceMechanic puzzle={puzzle as any} answer={answer} onChange={v=>{last=v;set(v);}} disabled={false}/>;}await act(async()=>root.render(<Harness/>));for(const value of ['1','2','4','8'])await act(async()=>host.querySelector<HTMLButtonElement>(`button[aria-label="Activate ${value}"]`)!.click());expect(last).toEqual({type:'sequence',order:[1,3,2,0]});await act(async()=>button('Undo last switch').click());expect(last).toEqual({type:'sequence',order:[1,3,2]});await act(async()=>button('Reset switches').click());expect(last).toEqual({type:'sequence',order:[]});
});
it('walks a carrier with arrows and E, then places the item at a pedestal without mouse-only dragging',async()=>{
 const puzzle=spec.missions[2].puzzle;if(puzzle.type!=='match')throw Error();function Harness(){const [answer,set]=useState<PuzzleAnswer|null>(null);return <MatchMechanic puzzle={puzzle as any} answer={answer} onChange={v=>{last=v;set(v);}} disabled={false} reducedMotion/>;}await act(async()=>root.render(<Harness/>));const board=host.querySelector('[tabindex="0"]') as HTMLDivElement;
 const press=async(code:string)=>act(async()=>{board.focus();board.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));});for(const key of ['ArrowLeft','ArrowLeft','ArrowUp','ArrowUp','KeyE'])await press(key);expect(host.textContent).toContain('Carrying AND');for(const key of ['ArrowRight','ArrowRight','ArrowRight','ArrowRight','ArrowDown','ArrowDown','Space'])await press(key);expect(last).toEqual({type:'match',pairs:[[0,1]]});expect(host.textContent).toContain('AND → True if both inputs are true');await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Undo pairing for AND"]')!.click());expect(last).toEqual({type:'match',pairs:[]});
});
it('supports station-button walking with reduced motion and does not place carried items remotely',async()=>{
 const puzzle=spec.missions[2].puzzle;if(puzzle.type!=='match')throw Error();function Harness(){const [answer,set]=useState<PuzzleAnswer|null>(null);return <MatchMechanic puzzle={puzzle as any} answer={answer} onChange={v=>{last=v;set(v);}} disabled={false} reducedMotion/>;}await act(async()=>root.render(<Harness/>));await act(async()=>button('Walk to NOT').click());expect(last).toBe(null);await act(async()=>button('Pick up NOT').click());await act(async()=>button('Walk to Reverses the input').click());expect(last).toBe(null);await act(async()=>button('Place at Reverses the input').click());expect(last).toEqual({type:'match',pairs:[[2,0]]});
});
it('renders gate choice and numeric controls using public data only',async()=>{
 const base=spec.missions[1].puzzle as GatePuzzle;function Harness({puzzle}:{puzzle:GatePuzzle}){const [answer,set]=useState<PuzzleAnswer|null>(null);return <GateMechanic puzzle={puzzle} answer={answer} onChange={v=>{last=v;set(v);}} disabled={false}/>;}await act(async()=>root.render(<Harness puzzle={{...base,input:'choice',choices:['First','Second']}}/>));await act(async()=>host.querySelectorAll<HTMLInputElement>('input')[1].click());expect(last).toEqual({type:'gate',value:1});await act(async()=>root.render(<Harness puzzle={{...base,input:'number'}}/>));expect(host.querySelector('input')?.getAttribute('inputmode')).toBe('decimal');expect(host.innerHTML).not.toContain('tolerance');expect(host.innerHTML).not.toContain('1101');
});
