// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskNotifications } from '../useTaskNotifications';
import { requestTaskNotifications, reminderTime, showTaskReminder } from '../../lib/taskNotifications';
import type { Task } from '../../types';
const shown: any[]=[];
let permission: NotificationPermission='granted';
const ask=vi.fn(async()=>{permission='granted';return permission;});
class MockNotification {
  static get permission(){return permission;}
  static requestPermission=ask;
  onclick: (()=>void)|null=null;
  close(){}
  constructor(title:string, options:any){shown.push({title,...options});}
}
let root:Root;
let current: ReturnType<typeof useTaskNotifications>;
const task:Task={id:'a',title:'Write report',cat:'work',date:'2026-10-26',status:'todo',reminder:'2026-10-26T09:00',note:'PRIVATE_NOTE',progress:0};
function Harness({tasks=[task],user='user-a'}:{tasks?:Task[];user?:string|null}){current=useTaskNotifications(tasks,user);return null;}
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T08:59:59'));
  vi.stubGlobal('Notification',MockNotification);permission='granted';shown.length=0;ask.mockClear();localStorage.clear();
  root=createRoot(document.createElement('div'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();});
it('asks only once from an explicit request, even with concurrent clicks or later attempts',async()=>{
  permission='default';
  await act(async()=>root.render(<Harness/>));expect(ask).not.toHaveBeenCalled();
  await Promise.all([requestTaskNotifications(),requestTaskNotifications()]);
  await requestTaskNotifications();expect(ask).toHaveBeenCalledOnce();
  expect(localStorage.getItem('zenos_notification_permission_asked')).toBe('1');
});
it('notifies at reminder time and persists deduplication without exposing notes',async()=>{
  await act(async()=>root.render(<Harness/>));expect(shown).toHaveLength(0);
  await act(async()=>vi.advanceTimersByTimeAsync(1000));expect(shown).toHaveLength(1);
  expect(shown[0].body).toBe('Write report');expect(JSON.stringify(shown)).not.toContain('PRIVATE_NOTE');
  await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(shown).toHaveLength(1);
  expect(showTaskReminder(task,'user-a')).toBe(false);
});
it('cancels scheduled reminders when a task completes or the user signs out',async()=>{
  await act(async()=>root.render(<Harness/>));
  await act(async()=>root.render(<Harness tasks={[{...task,status:'done'}]}/>));
  await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(shown).toHaveLength(0);
  await act(async()=>root.render(<Harness tasks={[{...task,reminder:'2026-10-26T09:01'}]}/>));
  await act(async()=>root.render(<Harness user={null}/>));
  await act(async()=>vi.advanceTimersByTimeAsync(120000));expect(shown).toHaveLength(0);
});
it('does not notify without permission, for invalid reminders, or for old reminders loaded at login',async()=>{
  permission='denied';await act(async()=>root.render(<Harness/>));
  await act(async()=>vi.advanceTimersByTimeAsync(1000));expect(shown).toHaveLength(0);
  expect(reminderTime({...task,reminder:'2026-02-31T09:00'})).toBeNull();
  expect(reminderTime({...task,status:'done'})).toBeNull();
  permission='granted';await act(async()=>root.render(<Harness user='new-user' tasks={[{...task,reminder:'2026-10-25T09:00'}]}/>));
  expect(shown).toHaveLength(0);
});
it('ignores reminders that were already overdue before this account session began',async()=>{
  await act(async()=>root.render(<Harness tasks={[{...task,reminder:'2026-10-25T09:00'}]}/>));
  await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(shown).toHaveLength(0);
});
