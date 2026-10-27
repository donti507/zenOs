// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import SpaceLearn from '../SpaceLearn';
const ctx=vi.hoisted(()=>({user:{id:'owner'},isOffline:true,readSpaceVersion:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
let host:HTMLDivElement,root:Root;
const versions:any={parent:{id:'parent',kind:'initial',html:'<h1>Old</h1>',css:'',js:''},edit:{id:'edit',kind:'ai',parentVersionId:'parent',prompt:'Change the title',explanation:'Changed the heading so the title matches your request.',html:'<h1>New</h1>\n<img src=x onerror=alert(1)>',css:'',js:''}};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);ctx.user={id:'owner'};ctx.readSpaceVersion.mockReset().mockImplementation(async(_page,id)=>versions[id]);});
afterEach(async()=>{await act(async()=>root.unmount());});
it('loads the actual predecessor, explains the edit and renders highlighted code only as escaped text',async()=>{
 await act(async()=>root.render(<SpaceLearn pageId="page" versionId="edit"/>));
 expect(ctx.readSpaceVersion).toHaveBeenCalledWith('page','parent');
 expect(host.textContent).toContain(versions.edit.explanation);
 expect(host.querySelectorAll('[data-change="added"]')).toHaveLength(2);
 expect(host.querySelector('[data-change="removed"]')?.textContent).toContain('Old');
 expect(host.querySelector('[data-change="added"]')?.textContent).toContain('New');
 expect(host.querySelector('img')).toBeNull();expect(host.querySelector('iframe')).toBeNull();
 expect(host.textContent).toContain('<img src=x');
});
it('handles legacy versions without inventing an explanation or comparison',async()=>{
 ctx.readSpaceVersion.mockResolvedValue({...versions.edit,parentVersionId:null,explanation:''});
 await act(async()=>root.render(<SpaceLearn pageId="page" versionId="legacy"/>));
 expect(host.textContent).toContain('no saved learning explanation');
 expect(host.textContent).toContain('unavailable for this older save point');
 expect(host.querySelector('code')).toBeNull();
});
it('shows a retryable storage failure and ignores old-account reads',async()=>{
 ctx.readSpaceVersion.mockRejectedValueOnce(new Error('storage unavailable'));
 await act(async()=>root.render(<SpaceLearn pageId="page" versionId="edit"/>));
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
 await act(async()=>host.querySelector('button')!.click());
 expect(host.textContent).toContain(versions.edit.explanation);
 let finish:any;ctx.readSpaceVersion.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>root.render(<SpaceLearn pageId="page" versionId="waiting"/>));
 ctx.user={id:'other'};ctx.readSpaceVersion.mockResolvedValue({...versions.parent,explanation:'Other user page'});
 await act(async()=>root.render(<SpaceLearn pageId="other-page" versionId="parent"/>));
 await act(async()=>finish({...versions.edit,parentVersionId:null}));
 expect(host.textContent).toContain('Other user page');expect(host.textContent).not.toContain(versions.edit.explanation);
});
