// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {useFocusTimer,focusSecondsLeft} from '../useFocusTimer';
import type {Task} from '../../types';
it('starts a five-minute deadline, survives renders, catches elapsed background time and clears on account change',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T09:00:00Z'));
 const root=createRoot(document.createElement('div'));let timer:ReturnType<typeof useFocusTimer>;
 function Harness({user='a'}:{user?:string|null}){timer=useFocusTimer(user);return null;}
 try{
  await act(async()=>root.render(<Harness/>));
  await act(async()=>timer.startFocus({id:'task',title:'Report',status:'todo'} as Task));
  const end=timer.focusSession!.endsAt;expect(focusSecondsLeft(end)).toBe(300);
  await act(async()=>root.render(<Harness/>));expect(timer.focusSession!.endsAt).toBe(end);
  vi.setSystemTime(new Date(end+10000));expect(focusSecondsLeft(end)).toBe(0);
  await act(async()=>root.render(<Harness user='b'/>));expect(timer.focusSession).toBeNull();
 }finally{await act(async()=>root.unmount());vi.useRealTimers();}
});
