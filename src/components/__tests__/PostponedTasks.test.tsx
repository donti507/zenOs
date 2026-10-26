// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import PostponedTasks from '../PostponedTasks';
const ctx=vi.hoisted(()=>({state:{tasks:[{id:'a',title:'Report',status:'todo',postponedCount:3},{id:'b',title:'Not yet',status:'todo',postponedCount:2},{id:'c',title:'Done',status:'done',postponedCount:5}]},startTaskFocus:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
let location:any;function Location(){location=useLocation();return null;}
it('nudges only open tasks postponed 3+ times, hands off an append-only three-step prompt and starts focus',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');const root=createRoot(host);
 try{
  await act(async()=>root.render(<MemoryRouter><PostponedTasks/><Location/></MemoryRouter>));
  expect(host.querySelectorAll('article')).toHaveLength(1);
  expect(host.textContent).toContain('This moved 3 times. Want to just do the first 5 minutes?');
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Start 5-min focus')!.click());
  expect(ctx.startTaskFocus).toHaveBeenCalledWith('a');
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Break it down with Dante')!.click());
  expect(location.pathname).toBe('/dante');expect(location.state.prompt).toContain('exactly 3');expect(location.state.prompt).toContain('checklist steps');expect(location.state.prompt).toContain('add_task_steps');expect(location.state.prompt).toContain('"a"');
 }finally{await act(async()=>root.unmount());}
});
