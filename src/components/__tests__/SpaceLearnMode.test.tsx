// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import Space from '../../pages/Space';
const ctx=vi.hoisted(()=>({user:{id:'a'},isOffline:true,spacePages:[],loadSpacePage:vi.fn(),spaceHistory:vi.fn(),readSpaceVersion:vi.fn(),editSpacePage:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
vi.mock('../SpaceFrame',()=>({default:()=> <div>Sandbox preview</div>}));
it('toggles Learn mode and automatically explains each new edit, with earlier explanations reachable from history',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const page={id:'page',slug:'study',title:'Study',permissions:{tasks:false,events:false}};
 const base={id:'base',pageId:'page',kind:'initial',createdAt:new Date().toISOString(),html:'<h1>Old</h1>',css:'',js:'',prompt:'',reply:'',model:''};
 const edit={...base,id:'edit',kind:'ai',parentVersionId:'base',prompt:'Update title',reply:'Updated',explanation:'Changed the heading so it matches your new title.',html:'<h1>New</h1>'};
 let current=base;
 ctx.loadSpacePage.mockImplementation(async()=>({page,version:current}));
 ctx.spaceHistory.mockImplementation(async()=>current===base?[base]:[edit,base]);
 ctx.readSpaceVersion.mockImplementation(async(_page,id)=>id==='base'?base:edit);
 ctx.editSpacePage.mockImplementation(async()=>{current=edit;return {page,version:edit};});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ready:true,models:['allowed'],authRequired:false})));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(el=>el.textContent===text)!;
 try {
 await act(async()=>root.render(<MemoryRouter initialEntries={['/space/study']}><Routes><Route path="/space/:slug" element={<Space/>}/></Routes></MemoryRouter>));
 expect(host.querySelector('[aria-label="Learn about this edit"]')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
 expect(host.textContent).toContain('This is the starting page');
 expect(ctx.editSpacePage).not.toHaveBeenCalled();
 const textarea=host.querySelector('form textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Update title');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('Send edit').click());
 expect(ctx.editSpacePage).toHaveBeenCalledOnce();expect(host.textContent).toContain(edit.explanation);
 expect(host.querySelector('[data-change="added"]')?.textContent).toContain('New');
 await act(async()=>Array.from(host.querySelectorAll('button')).filter(el=>el.textContent==='Explain this version').at(-1)!.click());
 expect(host.textContent).toContain('This is the starting page');
 await act(async()=>host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
 expect(host.querySelector('[aria-label="Learn about this edit"]')).toBeNull();
 } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
