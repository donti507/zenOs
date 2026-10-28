// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
const mock = vi.hoisted(() => ({
  user: 'a' as string | null, listener: null as any, rows: {} as Record<string, any[]>, channels: [] as any[], removed: [] as any[],
  sessionGate: null as Promise<void> | null, readGate: null as Promise<void> | null, mutationGate: null as Promise<void> | null, lastMutation: null as any,
}));
vi.mock('../../lib/supabase', () => ({ SUPABASE_CONFIGURED: true, supabase: {
  auth: {
    getSession: async () => { const session=mock.user ? { user:{id:mock.user},access_token:'test-jwt' } : null; await mock.sessionGate; return {data:{session}}; },
    onAuthStateChange: (callback: any) => { mock.listener = callback; return {data:{subscription:{unsubscribe(){mock.listener=null;}}}}; },
    signOut: async () => { mock.user=null; mock.listener?.('SIGNED_OUT',null); return {error:null}; },
  },
  realtime: { setAuth: async () => {} },
  channel: (topic: string, config: any) => {
    const channel: any = {topic,config,handlers:{} as any,
      on: (_kind: string, filter: any, callback: any) => { channel.handlers[filter.event]=callback; return channel; },
      subscribe: (callback: any) => { channel.status=callback; return channel; },
    }; mock.channels.push(channel); return channel;
  },
  removeChannel: async (channel: any) => { mock.removed.push(channel); return 'ok'; },
  from: (table: string) => {
    let inserted: any;const filters:any[]=[];
    const chain: any = {
      select: () => chain,is:(key:string,value:any)=>{filters.push([key,value]);return chain;}, order: () => chain, limit: () => chain, eq: (key:string,value:any) => {filters.push([key,value]);return chain;},
      insert: (data: any) => { inserted=data; return chain; },
      single: async () => {
        const row={id:'created',created_at:'2026-10-27',added_at:'2026-10-27',...inserted}; mock.lastMutation=row;
        await mock.mutationGate; return {data:row,error:null};
      },
      then: (resolve: any, reject: any) => {
        const rows=structuredClone((mock.rows[table]||[]).filter(row=>table==='workspaces'||row.user_id===mock.user||row.workspace_id==='team').filter(row=>filters.every(([key,value])=>(row[key]??null)===value)));
        return (async()=>{if(table==='tasks')await mock.readGate; return {data:rows,error:null};})().then(resolve,reject);
      },
    }; return chain;
  },
} }));
let root: Root; let ctx: ReturnType<typeof useZenos>;
function Consumer(){ctx=useZenos();return null;}
const event = (channel: any, table: string, operation: string, row: any) => channel.handlers[operation]({event:operation,payload:{schema:'public',table,operation,record:operation==='DELETE'?null:row,old_record:operation==='DELETE'?row:null}});
const emit = (table: string, operation: string, row: any, channel=mock.channels.at(-1)) => act(async()=>event(channel,table,operation,row));
const mount = () => act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mock.user='a';mock.listener=null;mock.channels=[];mock.removed=[];mock.readGate=null;mock.sessionGate=null;mock.mutationGate=null;mock.lastMutation=null;
  mock.rows={workspaces:[{id:'team',user_id:'a',name:'Team'}],tasks:[{id:'task',user_id:'a',title:'old',status:'todo'}],categories:[{id:'cat',user_id:'a',label:'Work'},{id:'cat-b',user_id:'b',label:'Personal'}],meetings:[{id:'meet',user_id:'a',subject:'old',created_at:'2026-10-27'}],vault_items:[{id:'vault',user_id:'a',name:'old',added_at:'2026-10-27'}]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({enabled:false})}));
  localStorage.clear(); sessionStorage.clear(); root=createRoot(document.createElement('div'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});

it('defaults to personal rows and switches all four collections plus private chat to the selected shared workspace',async()=>{
 for(const [table,key] of [['tasks','title'],['categories','label'],['meetings','subject'],['vault_items','name']])mock.rows[table].push({id:'shared-'+table,user_id:'b',workspace_id:'team',[key]:'Shared'});
 mock.rows.tasks.push({id:'own-shared',user_id:'a',workspace_id:'team',title:'Own shared'});
 mock.rows.dante_messages=[{id:'private-chat',user_id:'a',role:'user',content:'Private history',created_at:'2026-10-28'},{id:'shared-chat',user_id:'a',workspace_id:'team',role:'user',content:'Shared history',created_at:'2026-10-28'}];
 await mount();expect(ctx.activeWorkspaceId).toBeNull();expect(ctx.state.tasks.map(t=>t.id)).toEqual(['task']);expect(ctx.state.danteHistory[0].content).toBe('Private history');
 const personal=mock.channels.at(-1);await act(async()=>ctx.switchWorkspace('team'));
 expect(ctx.state.workspaceId).toBe('team');expect(ctx.state.tasks.map(t=>t.id)).toEqual(['shared-tasks','own-shared']);expect(ctx.state.categories.map(t=>t.id)).toEqual(['shared-categories']);expect(ctx.state.danteHistory[0].content).toBe('Shared history');expect(ctx.state.danteMemory).toEqual([]);expect(ctx.googleEvents).toEqual([]);expect(mock.removed).toContain(personal);expect(mock.channels.at(-1).topic).toBe('zenos:shared:team');
 await act(async()=>ctx.switchWorkspace(null));expect(ctx.state.tasks.map(t=>t.id)).toEqual(['task']);expect(ctx.state.danteHistory[0].content).toBe('Private history');
});
it('sets workspace and verified creator on new items, and ignores late inserts after switching',async()=>{
 await mount();await act(async()=>ctx.switchWorkspace('team'));
 await act(async()=>ctx.addTask({title:'Team task',cat:'other',status:'todo',date:'',reminder:'',note:'',progress:0}));
 expect(mock.lastMutation).toMatchObject({workspace_id:'team',user_id:'a'});expect(ctx.state.tasks.map(t=>t.id)).toEqual(['created']);
 let release!:()=>void;mock.mutationGate=new Promise<void>(resolve=>release=resolve);let task:any;
 await act(async()=>{task=ctx.addTask({title:'Late',cat:'other',status:'todo',date:'',reminder:'',note:'',progress:0});});await act(async()=>ctx.switchWorkspace(null));await act(async()=>{release();await task;});expect(ctx.state.tasks.map(t=>t.id)).toEqual(['task']);
});
it('merges shared invalidations via canonical reads and clears access on membership loss',async()=>{
 mock.rows.tasks.push({id:'shared',user_id:'b',workspace_id:'team',title:'First'});await mount();await act(async()=>ctx.switchWorkspace('team'));
 const channel=mock.channels.at(-1);mock.rows.tasks.push({id:'second',user_id:'a',workspace_id:'team',title:'Second'});
 await act(async()=>channel.handlers.changed({payload:{workspace_id:'team'}}));await act(async()=>channel.handlers.changed({payload:{workspace_id:'team'}}));expect(ctx.state.tasks.map(t=>t.id)).toEqual(['shared','second']);
 mock.rows.workspaces=[];await act(async()=>{await ctx.refreshWorkspaces();});expect(ctx.activeWorkspaceId).toBeNull();expect(ctx.state.tasks.map(t=>t.id)).toEqual(['task']);expect(mock.removed).toContain(channel);
});
it('keeps local mode personal with no shared channels or cloud membership fetches',async()=>{await mount();await act(async()=>ctx.loginOffline());const count=mock.channels.length;await act(async()=>ctx.switchWorkspace('team'));expect(ctx.isOffline).toBe(true);expect(ctx.activeWorkspaceId).toBeNull();expect(ctx.workspaces).toEqual([]);expect(mock.channels.length).toBe(count);});
