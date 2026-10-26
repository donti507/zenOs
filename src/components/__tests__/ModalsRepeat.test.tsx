// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import Modals from '../Modals';
const ctx=vi.hoisted(()=>({
  state:{tasks:[{id:'task',title:'Routine',cat:'other',status:'todo',date:'2026-10-26',reminder:'2026-10-26T09:00',progress:0,steps:[],note:'',recurrence:'none'}],categories:[{id:'other',label:'Other'}],selectedDate:null,filterCat:null},
  showModal:'editTask',editTaskId:'task',canAskNotifications:true,notificationPermission:'default',
  setShowModal:vi.fn(),setEditTaskId:vi.fn(),addTask:vi.fn(),editTask:vi.fn(async()=>{}),deleteTask:vi.fn(),addCategory:vi.fn(),updateState:vi.fn(),addMeeting:vi.fn(),fetchGoogleEvents:vi.fn(),accessToken:null,enableTaskNotifications:vi.fn(async()=>{}),
}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
vi.mock('../ui/kit',()=>({btn:{ghost:'',solid:'',danger:'',secondary:''},input:'',textarea:'',Icon:()=>null,Field:({label,children}:any)=><label>{label}{children}</label>,Modal:({open,children,footer}:any)=>open?<div>{children}{footer}</div>:null}));
it('offers every repeat option, saves recurrence, and requests reminder permission from the save gesture',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');const root=createRoot(host);
 try{
  await act(async()=>root.render(<Modals/>));
  const select=Array.from(host.querySelectorAll('label')).find(el=>el.textContent?.startsWith('Repeat'))!.querySelector('select')!;
  expect(Array.from(select.options).map(option=>option.value)).toEqual(['none','daily','weekdays','weekly','monthly']);
  await act(async()=>{select.value='weekly';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Save changes')!.click());
  expect(ctx.editTask).toHaveBeenCalledWith('task',expect.objectContaining({recurrence:'weekly'}));
  expect(ctx.enableTaskNotifications).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());}
});
