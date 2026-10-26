// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {ZenosProvider,useZenos} from '../ZenosContext';
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:false,supabase:{}}));
it('counts local date edits exactly once per later transition and persists history',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 let ctx:ReturnType<typeof useZenos>;function Consumer(){ctx=useZenos();return null;}
 const root=createRoot(document.createElement('div'));
 try{
  await act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));await act(async()=>ctx.loginOffline());
  await act(async()=>{await ctx.addTask({title:'Report',cat:'other',status:'todo',date:'2026-10-27',reminder:'',note:'',progress:0});});
  const id=ctx.state.tasks[0].id;
  await act(async()=>{await ctx.editTask(id,{date:'2026-10-28'});await ctx.editTask(id,{date:'2026-10-28'});});expect(ctx.state.tasks[0].postponedCount).toBe(1);
  await act(async()=>ctx.editTask(id,{date:'2026-10-29'}));await act(async()=>ctx.editTask(id,{date:'2026-10-30'}));
  expect(ctx.state.tasks[0].postponedCount).toBe(3);
  await act(async()=>ctx.editTask(id,{date:'2026-10-27',postponedCount:0}));expect(ctx.state.tasks[0].postponedCount).toBe(3);
  expect(JSON.parse(localStorage.getItem('zenos_tasks')!)[0].postponedCount).toBe(3);
 }finally{await act(async()=>root.unmount());}
});
