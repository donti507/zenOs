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
