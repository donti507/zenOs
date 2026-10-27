// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ZenosProvider,useZenos} from '../ZenosContext';
import DanteMemoryPanel from '../../components/DanteMemoryPanel';
import {buildDanteContext} from '../../lib/dante';
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:false,supabase:{}}));
let root:Root,host:HTMLDivElement,ctx:ReturnType<typeof useZenos>;
function Consumer(){ctx=useZenos();return <DanteMemoryPanel/>;}
const mount=()=>act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));
const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({enabled:false})}));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('persists explicit local facts across reload without sending them to Supabase',async()=>{
 await mount();await act(async()=>ctx.loginOffline());
 let first:any;await act(async()=>{first=await ctx.rememberFact('  I prefer mornings  ');await ctx.rememberFact('I prefer mornings');});
 expect(ctx.state.danteMemory).toHaveLength(1);expect(ctx.state.danteMemory?.[0]).toEqual(first);
 expect(JSON.parse(localStorage.getItem('zenos_dante_memory')!)[0].fact).toBe('I prefer mornings');
 await act(async()=>root.unmount());root=createRoot(host);await mount();await act(async()=>ctx.loginOffline());
 expect(ctx.state.danteMemory?.[0].fact).toBe('I prefer mornings');
 expect(buildDanteContext(ctx.state,[],'Anna','en').memory[0].fact).toBe('I prefer mornings');
 expect(host.textContent).toContain('What Dante remembers');
});
it('validates Unicode/length and enforces 100 facts even for rapid sequential actions',async()=>{
 await mount();await act(async()=>ctx.loginOffline());
 for(const invalid of ['', ' ', 'x'.repeat(201)])await expect(ctx.rememberFact(invalid)).rejects.toThrow('1–200');
 await act(async()=>{await ctx.rememberFact('🧠'.repeat(200));for(let i=1;i<100;i++)await ctx.rememberFact(`Fact ${i}`);});
 expect(ctx.state.danteMemory).toHaveLength(100);await expect(ctx.rememberFact('One too many')).rejects.toThrow('100 facts');
 expect(buildDanteContext(ctx.state,[],'Anna','en','voice').memory).toHaveLength(30);
});
it('requires confirmation for panel deletion, supports cancellation and keeps chat history',async()=>{
 await mount();await act(async()=>ctx.loginOffline());
 await act(async()=>{await ctx.rememberFact('I prefer mornings');ctx.updateState({danteHistory:[{role:'user',content:'Keep history',ts:1}]});});
 await act(async()=>button('Forget').click());expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(ctx.state.danteMemory).toHaveLength(1);
 await act(async()=>button('Cancel').click());expect(ctx.state.danteMemory).toHaveLength(1);
 await act(async()=>button('Forget').click());await act(async()=>button('Forget fact').click());
 expect(ctx.state.danteMemory).toHaveLength(0);expect(JSON.parse(localStorage.getItem('zenos_dante_memory')!)).toEqual([]);
 expect(ctx.state.danteHistory[0].content).toBe('Keep history');
});
it('renders facts as plain text and cancels pending deletion when the account signs out',async()=>{
 await mount();await act(async()=>ctx.loginOffline());
 await act(async()=>ctx.rememberFact('<img src=x onerror=alert(1)>'));
 expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
 let confirmation!:Promise<boolean>;
 await act(async()=>{confirmation=ctx.confirmForgetFact(ctx.state.danteMemory![0]);});
 await act(async()=>ctx.logOut());expect(await confirmation).toBe(false);expect(document.querySelector('[role="dialog"]')).toBeNull();
});
