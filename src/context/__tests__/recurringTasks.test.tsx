// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:false,supabase:{}}));
let ctx:ReturnType<typeof useZenos>;let root:Root;
function Consumer(){ctx=useZenos();return null;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();localStorage.setItem('zenos_completion_log','["2026-01-01"]');root=createRoot(document.createElement('div'));});
afterEach(async()=>{await act(async()=>root.unmount());});
it('persists local successors and monthly anchors through edits, checklist reset and repeated completions',async()=>{
  await act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));
  await act(async()=>ctx.loginOffline());
  await act(async()=>{await ctx.addTask({title:'Monthly',cat:'other',status:'todo',date:'2027-01-31',reminder:'2027-01-30T09:00',note:'Keep',progress:50,steps:[{label:'First',done:true}],recurrence:'monthly'});});
  const parent=ctx.state.tasks[0];
  await act(async()=>{await ctx.editTask(parent.id,{status:'done'});await ctx.editTask(parent.id,{status:'done'});});
  expect(ctx.state.tasks).toHaveLength(2);
  expect(ctx.state.completionLog).toHaveLength(2);expect(ctx.state.completionLog[0]).toBe('2026-01-01');
  const child=ctx.state.tasks[1];
  expect(child).toMatchObject({date:'2027-02-28',reminder:'2027-02-27T09:00',recurrenceDay:31,progress:0,steps:[{label:'First',done:false}]});
  await act(async()=>ctx.editTask(child.id,{date:child.date,note:'Edited',recurrence:'monthly'}));
  await act(async()=>ctx.toggleTaskDone(child.id));
  expect(ctx.state.tasks[2].date).toBe('2027-03-31');
  expect(JSON.parse(localStorage.getItem('zenos_tasks')!)).toHaveLength(3);
  await act(async()=>ctx.toggleTaskDone(parent.id));
  await act(async()=>ctx.toggleTaskDone(parent.id));
  expect(ctx.state.tasks).toHaveLength(3);
});
