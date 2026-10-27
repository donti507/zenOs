// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import SnapDialog from '../SnapDialog';
const mocked=vi.hoisted(()=>({extract:vi.fn(),prepare:vi.fn(),addTask:vi.fn(),addMeeting:vi.fn()}));
vi.mock('../../lib/snap',async()=>({...await vi.importActual<any>('../../lib/snap'),extractSnap:mocked.extract}));
vi.mock('../../lib/snapFile',()=>({SNAP_ACCEPT:'image/png,application/pdf',prepareSnapFile:mocked.prepare}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>({user:{id:'a'},getAuthToken:async()=> 'user-token',addTask:mocked.addTask,addMeeting:mocked.addMeeting,state:{categories:[{id:'other',label:'Other'}]}})}));
vi.mock('../ui/kit',()=>({btn:{primary:'',secondary:''},input:'',Field:({label,children}:any)=><label>{label}{children}</label>,Modal:({children,footer}:any)=><div role="dialog">{children}{footer}</div>}));
let host:HTMLElement;let container:HTMLDivElement;let root:Root;
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 mocked.extract.mockReset().mockResolvedValue([{title:'Essay',date:'2026-11-02',type:'exam'},{title:'Office hours',date:'2026-11-03',type:'meeting'}]);
 mocked.prepare.mockReset().mockResolvedValue({image:new Blob(['photo'],{type:'image/png'}),pages:1});
 mocked.addTask.mockReset().mockResolvedValue({id:'task'});mocked.addMeeting.mockReset().mockResolvedValue({id:'meeting'});
 vi.stubGlobal('URL',class extends URL { static createObjectURL=vi.fn(()=> 'blob:preview'); static revokeObjectURL=vi.fn(); });
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);host=document.body;
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!;
async function open(){
 await act(async()=>root.render(<SnapDialog onClose={()=>{}}/>));
 const file=host.querySelector<HTMLInputElement>('input[type="file"]')!;
 await act(async()=>{Object.defineProperty(file,'files',{configurable:true,value:[new File(['photo'],'photo.png',{type:'image/png'})]});file.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>button('Extract items').click());
}
it('requires review, supports edits/unchecking, and prevents created rows being created twice',async()=>{
 await open();expect(mocked.addTask).not.toHaveBeenCalled();expect(mocked.addMeeting).not.toHaveBeenCalled();
 const title=host.querySelector<HTMLInputElement>('[aria-label="Title 1"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'Edited essay');title.dispatchEvent(new Event('input',{bubbles:true}));});
 const type=host.querySelector<HTMLSelectElement>('[aria-label="Type 1"]')!;
 await act(async()=>{type.value='task';type.dispatchEvent(new Event('change',{bubbles:true}));host.querySelector<HTMLInputElement>('[aria-label="Include item 2"]')!.click();});
 await act(async()=>button('Create 1 selected').click());
 expect(mocked.addTask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({title:'Edited essay'}));expect(mocked.addMeeting).not.toHaveBeenCalled();
 expect(button('Create 0 selected').disabled).toBe(true);expect(host.textContent).toContain('Created 1 item');
 await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="Include item 2"]')!.click());
 await act(async()=>button('Create 1 selected').click());
 expect(mocked.addTask).toHaveBeenCalledOnce();expect(mocked.addMeeting).toHaveBeenCalledOnce();
});
it('shows extraction errors without creating any data',async()=>{
 mocked.extract.mockRejectedValue(new Error('Please wait a minute'));
 await open();expect(host.querySelector('[role="alert"]')?.textContent).toBe('Please wait a minute');expect(mocked.addTask).not.toHaveBeenCalled();
});
