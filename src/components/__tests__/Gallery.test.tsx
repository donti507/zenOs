// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import Gallery from '../../pages/Gallery';
const ctx=vi.hoisted(()=>({user:{id:'owner'},isOffline:false,state:{theme:'light'},toggleTheme:vi.fn(),getGalleryAccount:vi.fn(),listGallery:vi.fn(),readGalleryPage:vi.fn(),getGalleryTree:vi.fn(),remixGalleryPage:vi.fn(),reportGalleryPage:vi.fn(async()=>{}),moderateGalleryPage:vi.fn(async()=>{})}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
vi.mock('../SpaceFrame',()=>({default:({publicPreview}:any)=><div data-public-preview={String(publicPreview)}>Public sandbox</div>}));
let host:HTMLDivElement,root:Root;
const id='10000000-0000-0000-0000-000000000001';const page={id,title:'Public timer',description:'Useful',author:'Alice',html:'',css:'',js:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),moderation:'hidden',published:true,reportCount:3};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();ctx.user={id:'owner'};ctx.getGalleryAccount.mockResolvedValue({isAdmin:false});ctx.listGallery.mockResolvedValue({pages:[page],hasMore:false});ctx.readGalleryPage.mockResolvedValue(page);ctx.getGalleryTree.mockResolvedValue([{id,title:'Public timer',author:'Alice',depth:0}]);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('shows public snapshots with the bridge disabled and includes credit/remix tree/report controls',async()=>{
 await act(async()=>root.render(<MemoryRouter initialEntries={['/gallery/'+id]}><Gallery/></MemoryRouter>));
 expect(host.querySelector('[data-public-preview="true"]')).not.toBeNull();expect(host.querySelector('[aria-label="Remix tree"]')?.textContent).toContain('Alice');expect(host.textContent).toContain('Remix into My Space');
 await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Report')!.click());
 await act(async()=>Array.from(document.body.querySelectorAll('button')).find(button=>button.textContent==='Submit report')!.click());expect(ctx.reportGalleryPage).toHaveBeenCalledWith(id,'inappropriate');
});
it('blocks the moderation UI from reading admin rows when the server denies admin status',async()=>{
 await act(async()=>root.render(<MemoryRouter initialEntries={['/gallery/moderation']}><Gallery/></MemoryRouter>));expect(host.textContent).toContain('Administrator access required');expect(ctx.listGallery).not.toHaveBeenCalled();expect(ctx.readGalleryPage).not.toHaveBeenCalled();
});
it('requires an explicit delete confirmation before invoking the moderator action',async()=>{
 ctx.getGalleryAccount.mockResolvedValue({isAdmin:true});await act(async()=>root.render(<MemoryRouter initialEntries={['/gallery/moderation?id='+id]}><Gallery/></MemoryRouter>));
 await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Delete publication')!.click());expect(ctx.moderateGalleryPage).not.toHaveBeenCalled();
 await act(async()=>Array.from(document.body.querySelectorAll('button')).find(button=>button.textContent==='Permanently delete')!.click());expect(ctx.moderateGalleryPage).toHaveBeenCalledWith(id,'delete',true);
});
