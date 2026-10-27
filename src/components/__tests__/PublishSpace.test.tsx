// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import PublishSpace from '../PublishSpace';
const ctx=vi.hoisted(()=>({isOffline:false,user:{id:'owner'},ownGalleryPage:vi.fn(async()=>null),publishGalleryPage:vi.fn(async()=> 'pub'),withdrawGalleryPage:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
it('keeps publication opt-in and requires renewed consent for a different saved version',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const snapshot:any={page:{id:'page',title:'Private title'},version:{id:'version1'}};
 const button=()=>Array.from(document.body.querySelectorAll('button')).find(el=>el.textContent==='Publish this version')!;
 try{
 await act(async()=>root.render(<MemoryRouter><PublishSpace snapshot={snapshot} onClose={()=>{}}/></MemoryRouter>));expect(button().disabled).toBe(true);expect(ctx.publishGalleryPage).not.toHaveBeenCalled();
 await act(async()=>document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(button().disabled).toBe(false);
 await act(async()=>root.render(<MemoryRouter><PublishSpace snapshot={{...snapshot,version:{id:'version2'}}} onClose={()=>{}}/></MemoryRouter>));expect(button().disabled).toBe(true);
 await act(async()=>document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await act(async()=>button().click());expect(ctx.publishGalleryPage).toHaveBeenCalledWith(expect.objectContaining({version:{id:'version2'}}),expect.objectContaining({consent:true,author:'Creator'}));
 }finally{await act(async()=>root.unmount());host.remove();}
});
