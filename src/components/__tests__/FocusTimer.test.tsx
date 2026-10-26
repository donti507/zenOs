// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import FocusTimer from '../FocusTimer';
const ctx=vi.hoisted(()=>({focusSession:null as any,stopTaskFocus:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
it('shows five minutes, catches elapsed background time, announces completion and can close',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
 const host=document.createElement('div');const root=createRoot(host);
 try{
  ctx.focusSession={userId:'a',taskId:'task',title:'Report',endsAt:Date.now()+300000};
  await act(async()=>root.render(<FocusTimer/>));expect(host.querySelector('[role="timer"]')?.textContent).toBe('05:00');
  expect(host.querySelector('[role="timer"]')?.getAttribute('aria-live')).toBe('off');
  vi.setSystemTime(new Date(ctx.focusSession.endsAt+60000));await act(async()=>window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('[role="timer"]')?.textContent).toBe('00:00');expect(host.querySelector('[role="status"]')?.textContent).toContain('Five minutes done');
  await act(async()=>host.querySelector('button')!.click());expect(ctx.stopTaskFocus).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());vi.useRealTimers();}
});
