// @vitest-environment jsdom
import React,{act,useEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import PuzzleOverlay from '../mechanics/PuzzleOverlay';
import {useAdventures} from '../../hooks/useAdventures';
import {lostBinaryKingdom as spec} from '../samples/lost-binary-kingdom';
const mock=vi.hoisted(()=>({ctx:null as any}));vi.mock('../../context/ZenosContext',()=>({useZenos:()=>mock.ctx}));
let root:Root,host:HTMLDivElement,onSolved:ReturnType<typeof vi.fn>,onClose:ReturnType<typeof vi.fn>;
function Harness(){const ctx=useAdventures({ownerId:'overlay-learner',isOffline:true});mock.ctx=ctx;const [ready,setReady]=useState(false);useEffect(()=>{let active=true;void ctx.loadAdventure('lost-binary-kingdom').then(()=>{if(active){ctx.advanceAdventureQuest('lost-binary-kingdom',{type:'accept',missionId:'power-path'});setReady(true);}});return()=>{active=false;};},[ctx.loadAdventure]);return ready?<PuzzleOverlay spec={spec} adventureId="lost-binary-kingdom" missionId="power-path" reducedMotion onClose={onClose} onSolved={onSolved}/>:null;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);onSolved=vi.fn();onClose=vi.fn();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
it('checks actual puzzle attempts, gates hint escalation and completes only after a correct order',async()=>{
 await act(async()=>root.render(<Harness/>));expect(button('Check answer').disabled).toBe(true);await act(async()=>button('Show nudge').click());expect(button('Show explanation').disabled).toBe(true);
 for(const value of ['8','1','4','2'])await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="Activate ${value}"]`)!.click());await act(async()=>{button('Check answer').click();await vi.dynamicImportSettled();});expect(document.body.textContent).toContain('Not correct yet');expect(document.body.textContent).toContain('Recognize powers of two.');expect(onSolved).not.toHaveBeenCalled();await act(async()=>button('Show explanation').click());expect(button('Show worked example').disabled).toBe(true);
 await act(async()=>{button('Check answer').click();await vi.dynamicImportSettled();});await act(async()=>button('Show worked example').click());expect(document.body.textContent).toContain('16 doubles to 32');await act(async()=>button('Reset switches').click());for(const value of ['1','2','4','8'])await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="Activate ${value}"]`)!.click());await act(async()=>{button('Check answer').click();await vi.dynamicImportSettled();});expect(document.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Puzzle solved');expect(onSolved).toHaveBeenCalledOnce();expect(onSolved.mock.calls[0][0]).toMatchObject({xpGranted:20});await act(async()=>button('Continue exploring').click());expect(onClose).toHaveBeenCalledOnce();
});
it('keeps focus within the overlay and closes on Escape without granting XP',async()=>{
 await act(async()=>root.render(<Harness/>));const buttons=[...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const first=buttons[0],last=buttons[buttons.length-1];await act(async()=>{last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});expect(document.activeElement).toBe(first);await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(onClose).toHaveBeenCalledOnce();expect(onSolved).not.toHaveBeenCalled();
});
