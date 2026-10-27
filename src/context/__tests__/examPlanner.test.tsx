// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ZenosProvider, useZenos } from '../ZenosContext';
import { remainingExamTasks } from '../../lib/examPlanner';
import { today } from '../../lib/utils';
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:false,supabase:{}}));
it('persists local plans, reuses Exams, skips busy days and moves only remaining sessions in place',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 let ctx: ReturnType<typeof useZenos>;function Consumer(){ctx=useZenos();return null;}
 const root=createRoot(document.createElement('div'));
 const draft={id:'exam',name:'Physics',examDate:'2099-11-10',minutesPerDay:50,topics:[{id:'atoms',title:'Atoms'},{id:'energy',title:'Energy'},{id:'waves',title:'Waves'}]};
 // Keep the scheduling window short without fake timers interfering with React.
 const date=today(); const exam=new Date(date+'T12:00:00');exam.setDate(exam.getDate()+5);
 const {localDateStr}=await import('../../lib/utils');draft.examDate=localDateStr(exam);
 try {
  await act(async()=>root.render(<ZenosProvider><Consumer/></ZenosProvider>));await act(async()=>ctx.loginOffline());
  await act(async()=>ctx.addCategory('EXAMS','#8151eb'));
  const busy=localDateStr(new Date(exam.getFullYear(),exam.getMonth(),exam.getDate()-1));
  for(let i=0;i<2;i++) await act(async()=>ctx.addMeeting({personName:'Teacher',subject:'Meeting',date:busy,time:'10:00',status:'upcoming',createdAt:new Date().toISOString()}));
  await act(async()=>ctx.saveExamPlan(draft));await act(async()=>ctx.saveExamPlan(draft));
  expect(ctx.state.tasks).toHaveLength(3);expect(ctx.state.categories.filter(c=>c.label.toLowerCase()==='exams')).toHaveLength(1);
  expect(ctx.state.tasks.every(t=>t.date!==busy)).toBe(true);
  const [first,second,third]=ctx.state.tasks;
  await act(async()=>ctx.editTask(first.id,{steps:first.steps.map(s=>({...s,done:true})),note:'Keep me'}));
  await act(async()=>ctx.editTask(second.id,{status:'done'}));
  const expected=remainingExamTasks(ctx.state.tasks,'exam');expect(expected.map(t=>t.id)).toEqual([third.id]);
  await act(async()=>ctx.saveExamPlan({...draft,topics:[{id:'waves',title:'Waves'}]},expected));
  expect(ctx.state.tasks.find(t=>t.id===first.id)).toMatchObject({note:'Keep me',steps:[{done:true}]});
  expect(ctx.state.tasks.find(t=>t.id===second.id).status).toBe('done');
  expect(ctx.state.tasks.find(t=>t.id===third.id)).toBeDefined();
  expect(JSON.parse(localStorage.getItem('zenos_tasks')!)).toHaveLength(3);
  const stale=remainingExamTasks(ctx.state.tasks,'exam');
  await act(async()=>ctx.editTask(third.id,{status:'done'}));
  await expect(ctx.saveExamPlan({...draft,topics:[{id:'waves',title:'Waves'}]},stale)).rejects.toThrow('Plan changed');
 } finally {await act(async()=>root.unmount());}
});
