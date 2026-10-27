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
    let inserted: any;
    const chain: any = {
      select: () => chain, order: () => chain, limit: () => chain, eq: () => chain,
      insert: (data: any) => { inserted=data; return chain; },
      single: async () => {
        const row={id:'created',created_at:'2026-10-27',added_at:'2026-10-27',...inserted}; mock.lastMutation=row;
        await mock.mutationGate; return {data:row,error:null};
      },
      then: (resolve: any, reject: any) => {
        const rows=structuredClone((mock.rows[table]||[]).filter(row=>row.user_id===mock.user));
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
  mock.rows={tasks:[{id:'task',user_id:'a',title:'old',status:'todo'}],categories:[{id:'cat',user_id:'a',label:'Work'},{id:'cat-b',user_id:'b',label:'Personal'}],meetings:[{id:'meet',user_id:'a',subject:'old',created_at:'2026-10-27'}],vault_items:[{id:'vault',user_id:'a',name:'old',added_at:'2026-10-27'}]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({enabled:false})}));
  localStorage.clear(); sessionStorage.clear(); root=createRoot(document.createElement('div'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('opens only the authenticated user private channel and merges all four table operations',async()=>{
  await mount();expect(mock.channels).toHaveLength(1);
  expect(mock.channels[0].topic).toBe('zenos:workspace:a');expect(mock.channels[0].config).toEqual({config:{private:true}});
  for(const [table,key,row] of [
    ['tasks','tasks',{id:'remote',user_id:'a',title:'Remote task'}],['categories','categories',{id:'remote',user_id:'a',label:'Remote category'}],
    ['meetings','meetings',{id:'remote',user_id:'a',subject:'Remote meeting',created_at:'2026-10-27'}],['vault_items','vault',{id:'remote',user_id:'a',name:'Remote vault',added_at:'2026-10-27'}],
  ] as const){
    await emit(table,'INSERT',row);await emit(table,'INSERT',row);expect(ctx.state[key].filter(item=>item.id==='remote')).toHaveLength(1);
    await emit(table,'UPDATE',{...row,title:'Updated',label:'Updated',subject:'Updated',name:'Updated'});
    expect(ctx.state[key].find(item=>item.id==='remote')).toMatchObject({id:'remote'});
    await emit(table,'DELETE',row);expect(ctx.state[key].some(item=>item.id==='remote')).toBe(false);
  }
  await emit('tasks','INSERT',{id:'foreign',user_id:'b',title:'must not leak'});
  await emit('tasks','DELETE',{id:'task',user_id:'b'});
  expect(ctx.state.tasks.map(row=>row.id)).toEqual(['task']);
});
it.each(['tasks','categories','meetings','vault_items'])('deduplicates a %s local mutation response after its echo and preserves a newer update',async table=>{
  await mount();let release!:()=>void;mock.mutationGate=new Promise(resolve=>{release=resolve;});
  let saving!:Promise<unknown>;
  await act(async()=>{
    saving=table==='tasks'?ctx.addTask({title:'old response',cat:'cat',status:'todo',date:'',reminder:'',note:'',progress:0}):table==='categories'?ctx.addCategory('old response','purple'):table==='vault_items'?ctx.addVaultItem({type:'link',name:'old response',detail:''}):ctx.addMeeting({personName:'Anna',subject:'old response',date:'2026-10-27',time:'10:00',status:'upcoming'});
  });
  const row=mock.lastMutation;await emit(table,'INSERT',row);await emit(table,'UPDATE',{...row,title:'newest',label:'newest',subject:'newest',name:'newest'});
  await act(async()=>{release();await saving;});
  const key=table==='vault_items'?'vault':table as 'tasks'|'categories'|'meetings';
  const rows=ctx.state[key].filter(item=>item.id==='created');expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveProperty(table==='tasks'?'title':table==='categories'?'label':table==='meetings'?'subject':'name','newest');
});
it('does not resurrect a row deleted before its delayed local mutation response',async()=>{
  await mount();let release!:()=>void;mock.mutationGate=new Promise(resolve=>{release=resolve;});let saving!:Promise<unknown>;
  await act(async()=>{saving=ctx.addTask({title:'New',cat:'cat',status:'todo',date:'',reminder:'',note:'',progress:0});});
  await emit('tasks','INSERT',mock.lastMutation);await emit('tasks','DELETE',mock.lastMutation);
  await act(async()=>{release();await saving;});expect(ctx.state.tasks.some(row=>row.id==='created')).toBe(false);
});
it('buffers events during snapshot recovery so stale reads cannot overwrite remote updates/deletes',async()=>{
  await mount();let release!:()=>void;mock.readGate=new Promise(resolve=>{release=resolve;});
  await act(async()=>mock.channels[0].status('SUBSCRIBED'));
  await emit('tasks','UPDATE',{...mock.rows.tasks[0],title:'live update'});
  await emit('categories','UPDATE',{...mock.rows.categories[0],label:'live label'});
  await emit('meetings','DELETE',mock.rows.meetings[0]);
  await emit('vault_items','INSERT',{id:'new-vault',user_id:'a',name:'live vault',added_at:'2026-10-27'});
  await act(async()=>{mock.readGate=null;release();});
  expect(ctx.state.tasks[0].title).toBe('live update');expect(ctx.state.categories[0].label).toBe('live label');
  expect(ctx.state.meetings).toHaveLength(0);expect(ctx.state.vault.some(row=>row.id==='new-vault')).toBe(true);
});
it('recovers changes missed while the socket was offline on every re-subscription',async()=>{
  await mount();
  const history=[{role:'user' as const,content:'keep local chat',ts:1}];
  await act(async()=>ctx.updateState({danteHistory:history}));
  mock.rows.tasks=[{...mock.rows.tasks[0],title:'changed offline'}];mock.rows.vault_items=[];
  await act(async()=>mock.channels[0].status('SUBSCRIBED'));
  expect(ctx.state.tasks[0].title).toBe('changed offline');expect(ctx.state.vault).toHaveLength(0);
  expect(mock.channels).toHaveLength(1);expect(ctx.state.danteHistory).toEqual(history);
});
it('unsubscribes on sign-out and ignores late events before and after React cleanup',async()=>{
  await mount();const old=mock.channels[0];
  await act(async()=>{const logout=ctx.logOut();event(old,'tasks','INSERT',{id:'late',user_id:'a',title:'late'});await logout;});
  expect(mock.removed).toEqual([old]);expect(ctx.user).toBeNull();
  await emit('tasks','INSERT',{id:'later',user_id:'a',title:'late'},old);expect(ctx.state.tasks).toHaveLength(0);
});
it('replaces channels on account switch without leaking old events or old snapshots',async()=>{
  await mount();const old=mock.channels[0];
  await act(async()=>{mock.user='b';mock.listener('SIGNED_IN',{user:{id:'b'},access_token:'new-jwt'});event(old,'tasks','INSERT',{id:'late',user_id:'a',title:'late'});await new Promise(resolve=>setTimeout(resolve,5));});
  expect(mock.removed).toContain(old);expect(mock.channels.at(-1).topic).toBe('zenos:workspace:b');
  expect(ctx.state.tasks).toHaveLength(0);expect(ctx.state.categories.map(row=>row.id)).toEqual(['cat-b']);
});
it('creates no channel signed out or in local mode, and removes a cloud subscription on local login',async()=>{
  mock.user=null;await mount();expect(mock.channels).toHaveLength(0);
  await act(async()=>ctx.loginOffline());expect(mock.channels).toHaveLength(0);
  await act(async()=>mock.listener('TOKEN_REFRESHED',{user:{id:'a'},access_token:'background-jwt'}));expect(mock.channels).toHaveLength(0);
  await act(async()=>{mock.user='a';mock.listener('SIGNED_IN',{user:{id:'a'},access_token:'jwt'});await new Promise(resolve=>setTimeout(resolve,5));});
  expect(mock.channels).toHaveLength(1);
  await act(async()=>ctx.loginOffline());expect(mock.removed).toHaveLength(1);
  await emit('tasks','INSERT',{id:'late',user_id:'a',title:'not local'});expect(ctx.state.tasks).toHaveLength(0);
});

it.each(['local','sign-out'])('does not let delayed initial session restoration reopen Realtime after %s',async action=>{
  let release!:()=>void;mock.sessionGate=new Promise(resolve=>{release=resolve;});
  await mount();expect(mock.channels).toHaveLength(0);
  await act(async()=>{if(action==='local')ctx.loginOffline();else await ctx.logOut();});
  await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,0));});
  expect(mock.channels).toHaveLength(0);
  if(action==='local'){expect(ctx.isOffline).toBe(true);expect(ctx.user.id).toBe('offline-user-123');}
  else expect(ctx.user).toBeNull();
});
