// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ZenosProvider,useZenos} from '../ZenosContext';
const mock=vi.hoisted(()=>({owner:'a',listener:null as any,memories:[] as any[],rpc:vi.fn(),deletes:[] as any[],readGate:null as Promise<void>|null}));
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:true,supabase:{
 auth:{getSession:async()=>({data:{session:{user:{id:mock.owner},access_token:'jwt'}}}),onAuthStateChange:(cb:any)=>{mock.listener=cb;return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({error:null})},
 realtime:{setAuth:async()=>{}},channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:async()=>{},
 rpc:(...args:any[])=>mock.rpc(...args),
 from:(table:string)=>{
  let operation='read';const filters:any[]=[];const chain:any={select:()=>chain,is:()=>chain,order:()=>chain,limit:()=>chain,eq:(key:string,value:any)=>{filters.push([key,value]);return chain;},delete:()=>{operation='delete';return chain;},
   then:(resolve:any,reject:any)=>{
    if(table!=='dante_memory')return Promise.resolve({data:table==='categories'?[{id:'work',label:'Work'}]:[],error:null}).then(resolve,reject);
    const rows=structuredClone(mock.memories.filter(row=>filters.every(([key,value])=>row[key]===value)));
    if(operation==='delete'){mock.deletes.push(filters);mock.memories=mock.memories.filter(row=>!filters.every(([key,value])=>row[key]===value));return Promise.resolve({error:null}).then(resolve,reject);}
    return (async()=>{await mock.readGate;return {data:rows,error:null};})().then(resolve,reject);
   },};return chain;
 },
}}));
let root:Root,ctx:ReturnType<typeof useZenos>;
function Consumer(){ctx=useZenos();return null;}
const mount=()=>act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();mock.owner='a';mock.listener=null;mock.readGate=null;mock.deletes=[];mock.rpc.mockReset();
 mock.memories=[{id:'a-memory',user_id:'a',fact:'Private A',created_at:'2026-10-27T10:00:00Z'},{id:'b-memory',user_id:'b',fact:'Private B',created_at:'2026-10-27T10:00:00Z'}];
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({enabled:false})}));root=createRoot(document.createElement('div'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('loads only account facts and binds remember/forget to the same account',async()=>{
 await mount();expect(ctx.state.danteMemory?.map(row=>row.fact)).toEqual(['Private A']);
 mock.rpc.mockResolvedValue({data:{id:'saved',fact:'My preference',created_at:'2026-10-27T11:00:00Z'},error:null});
 await act(async()=>ctx.rememberFact('My preference'));
 expect(mock.rpc).toHaveBeenCalledWith('remember_dante_fact',{p_fact:'My preference',p_owner:'a'});
 expect(ctx.state.danteMemory).toHaveLength(2);
 await act(async()=>ctx.forgetFact('a-memory'));expect(mock.deletes[0]).toEqual([['user_id','a'],['id','a-memory']]);
 expect(mock.memories.some(row=>row.user_id==='b')).toBe(true);
});
it('reports quota/storage errors without changing saved facts or leaking raw provider details',async()=>{
 await mount();mock.rpc.mockResolvedValue({data:null,error:{message:'Dante memory limit reached (100 facts)'}});
 await expect(ctx.rememberFact('new')).rejects.toThrow('100 facts');expect(ctx.state.danteMemory).toHaveLength(1);
 mock.rpc.mockResolvedValue({data:null,error:{message:'PRIVATE_INTERNAL_DETAIL'}});
 await expect(ctx.rememberFact('new')).rejects.toThrow('Could not save this fact');
});
it('ignores stale reads and rejects an old account action after switching users',async()=>{
 await mount();const oldRemember=ctx.rememberFact;let release!:()=>void;mock.readGate=new Promise(resolve=>{release=resolve;});
 let pending!:Promise<void>;await act(async()=>{pending=ctx.refreshDanteMemory();});
 await act(async()=>{mock.owner='b';mock.listener('SIGNED_IN',{user:{id:'b'},access_token:'new-jwt'});await new Promise(resolve=>setTimeout(resolve,0));});
 await act(async()=>{mock.readGate=null;release();await pending;});
 expect(ctx.state.danteMemory?.map(row=>row.fact)).toEqual(['Private B']);
 await expect(oldRemember('Private A must not leak')).rejects.toThrow('account changed');expect(mock.rpc).not.toHaveBeenCalled();
});

it('fences a local memory action as soon as cloud sign-in starts, before React switches users',async()=>{
 await mount();await act(async()=>ctx.loginOffline());const localRemember=ctx.rememberFact;
 await act(async()=>{
  mock.owner='b';mock.listener('SIGNED_IN',{user:{id:'b'},access_token:'new-jwt'});
  await expect(localRemember('Local data must not reach B')).rejects.toThrow('account changed');
  await new Promise(resolve=>setTimeout(resolve,0));
 });
 expect(ctx.state.danteMemory?.some(row=>row.fact==='Local data must not reach B')).toBe(false);expect(mock.rpc).not.toHaveBeenCalled();
});
