// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import ExamPlannerDialog from '../ExamPlannerDialog';
const mocked=vi.hoisted(()=>({save:vi.fn(),tasks:[] as any[]}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>({saveExamPlan:mocked.save,state:{tasks:mocked.tasks,meetings:[]},googleEvents:[]})}));
vi.mock('../ui/kit',()=>({btn:{primary:'',ghost:''},input:'',textarea:'',Field:({label,children}:any)=><label>{label}{children}</label>,Modal:({children,footer}:any)=><div role="dialog">{children}{footer}</div>}));
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mocked.save.mockReset().mockResolvedValue(undefined);mocked.tasks=[];container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=(text:string)=>Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent===text)!;
async function fill(label:string,value:string){const el=Array.from(document.body.querySelectorAll('label')).find(l=>l.textContent?.startsWith(label))!.querySelector('input,textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
it('validates inputs, requires review and allows retrying a failed transaction',async()=>{
 const close=vi.fn();await act(async()=>root.render(<ExamPlannerDialog onClose={close}/>));
 await act(async()=>button('Review sessions').click());expect(document.body.querySelector('[role="alert"]')).not.toBeNull();expect(mocked.save).not.toHaveBeenCalled();
 await fill('Exam name','Physics');await fill('Exam date','2026-11-10');await fill('Topics','Atoms\nEnergy');
 // Use a near-future date regardless of the machine date.
 const d=new Date();d.setDate(d.getDate()+4);const {localDateStr}=await import('../../lib/utils');await fill('Exam date',localDateStr(d));
 await act(async()=>button('Review sessions').click());expect(document.body.textContent).toContain('2 study tasks');expect(mocked.save).not.toHaveBeenCalled();
 mocked.save.mockRejectedValueOnce(new Error('Try again'));
 await act(async()=>button('Create study tasks').click());expect(document.body.querySelector('[role="alert"]')!.textContent).toBe('Try again');expect(close).not.toHaveBeenCalled();
 await act(async()=>button('Create study tasks').click());expect(mocked.save).toHaveBeenCalledTimes(2);expect(mocked.save.mock.calls[0][0].id).toBe(mocked.save.mock.calls[1][0].id);expect(close).toHaveBeenCalledOnce();
});
