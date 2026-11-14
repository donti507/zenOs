// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import AdventureViewport from '../AdventureViewport';
import {lostBinaryKingdom} from '../samples/lost-binary-kingdom';
const mocks=vi.hoisted(()=>({ctx:{} as any,mount:vi.fn(),reduced:false}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>mocks.ctx}));
vi.mock('../runtime',()=>({mountAdventure:mocks.mount}));
vi.mock('motion/react',async()=>{const actual=await vi.importActual('motion/react');return {...actual,useReducedMotion:()=>mocks.reduced};});
let root:Root,host:HTMLDivElement,handle:any;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mocks.reduced=false;mocks.ctx={adventureSettings:{lowPerformance:false,reducedMotion:false},setAdventureSettings:vi.fn(),liveOpen:false,showModal:null};handle={setMovement:vi.fn(),setPaused:vi.fn(),getPosition:()=>({x:7,y:9}),destroy:vi.fn()};mocks.mount.mockReset().mockImplementation(async options=>{queueMicrotask(()=>options.onReady());return handle;});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const render=()=>act(async()=>root.render(<AdventureViewport spec={lostBinaryKingdom}/>));
it('pauses on Escape, clears movement, resumes and destroys the engine on route cleanup',async()=>{
 await render();const viewport=host.querySelector('[tabindex="0"]') as HTMLDivElement;await act(async()=>{viewport.focus();viewport.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));});expect(handle.setMovement).toHaveBeenLastCalledWith({x:0,y:-1});
 await act(async()=>viewport.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true})));expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Adventure paused');expect(handle.setPaused).toHaveBeenLastCalledWith(true);
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Resume exploring')!.click());expect(handle.setPaused).toHaveBeenLastCalledWith(false);await act(async()=>root.unmount());expect(handle.destroy).toHaveBeenCalledOnce();root=createRoot(host);
});
it('honors device reduced motion and pauses when another app flow opens',async()=>{mocks.reduced=true;await render();expect(mocks.mount.mock.lastCall![0].reducedMotion).toBe(true);mocks.ctx.liveOpen=true;await render();expect(handle.setPaused).toHaveBeenLastCalledWith(true);expect(document.querySelector<HTMLInputElement>('input[type=checkbox]:disabled')?.checked).toBe(true);});
it('aborts unmounted lazy work and destroys a late engine without publishing its callbacks',async()=>{let resolve!:(value:any)=>void;mocks.mount.mockImplementation(()=>new Promise(r=>resolve=r));await render();const options=mocks.mount.mock.lastCall![0];await act(async()=>root.unmount());root=createRoot(host);expect(options.signal.aborted).toBe(true);await act(async()=>{options.onReady();options.onFailure();resolve(handle);});expect(handle.destroy).toHaveBeenCalledOnce();expect(document.querySelector('[role=dialog]')).toBe(null);});
it('opens nearby NPCs with E/Space, stops walking during dialogue and updates HUD/markers after preview completion',async()=>{
 mocks.reduced=true;handle.getPosition=()=>({x:7,y:7});mocks.mount.mockImplementation(async options=>{queueMicrotask(()=>{options.onPosition({x:7,y:7});options.onReady();});return handle;});handle.setProgress=vi.fn();mocks.ctx.adventureProgress={};
 const {transitionQuest}=await import('../systems/quest');mocks.ctx.advanceAdventureQuest=vi.fn((_id,action)=>{const result=transitionQuest(lostBinaryKingdom,mocks.ctx.adventureProgress['lost-binary-kingdom'],action);mocks.ctx.adventureProgress={'lost-binary-kingdom':result.progress};return result;});
 await render();const viewport=host.querySelector('[tabindex="0"]') as HTMLDivElement;const click=async(label:string)=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)!.click());
 await act(async()=>viewport.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true})));expect(document.querySelector('[role=dialog]')?.textContent).toContain('Professor Byte');expect(handle.setPaused).toHaveBeenLastCalledWith(true);await click('Next');await click('Next');await click('Accept mission');await render();expect(mocks.ctx.advanceAdventureQuest).toHaveBeenLastCalledWith('lost-binary-kingdom',{type:'accept',missionId:'power-path'});
 await act(async()=>viewport.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true})));await click('Next');await click('Next');await click('Complete preview step');await render();expect(host.textContent).toContain('20 preview XP');expect(host.textContent).toContain('Mission complete');expect(handle.setProgress).toHaveBeenLastCalledWith({accepted:[],completed:['power-path']});
});
it('rejects an NPC tap outside range even if a renderer reports a hit',async()=>{handle.npcAt=()=> 'byte';await render();const viewport=host.querySelector('[tabindex="0"]')!;await act(async()=>viewport.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:20,clientY:20})));expect(document.querySelector('[role=dialog]')).toBe(null);});
it('cancels synthetic mouse events for touch NPC taps and ignores drags',async()=>{
 mocks.reduced=true;handle.getPosition=()=>({x:7,y:7});handle.npcAt=()=> 'byte';await render();const viewport=host.querySelector('[tabindex="0"]')!;
 const event=(type:string,x:number)=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:50});Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'touch'}});return e;};
 const down=event('pointerdown',40);await act(async()=>viewport.dispatchEvent(down));expect(down.defaultPrevented).toBe(true);await act(async()=>viewport.dispatchEvent(event('pointerup',70)));expect(document.querySelector('[role=dialog]')).toBe(null);
 await act(async()=>viewport.dispatchEvent(event('pointerdown',40)));await act(async()=>viewport.dispatchEvent(event('pointerup',40)));expect(document.querySelector('[role=dialog]')?.textContent).toContain('Professor Byte');
});
