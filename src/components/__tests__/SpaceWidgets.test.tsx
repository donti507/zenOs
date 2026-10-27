// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import SpaceWidgets from '../SpaceWidgets';
const ctx=vi.hoisted(()=>({user:{id:'a'},isOffline:true,spacePages:[] as any[],loadSpacePage:vi.fn(),changeSpaceWidget:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
vi.mock('../SpaceFrame',()=>({default:({snapshot,widgetSize}:any)=><iframe title={snapshot.page.title} sandbox="allow-scripts" data-size={widgetSize}/>}));
it('shows only pinned pages in saved order with size/order/unpin controls and no obsolete version preview',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 ctx.spacePages=[{id:'one',slug:'one',title:'One',dashboardSize:'small',dashboardOrder:1,currentVersionId:'v1'},{id:'two',slug:'two',title:'Two',dashboardSize:'medium',dashboardOrder:0,currentVersionId:'v2'},{id:'hidden',slug:'hidden',title:'Hidden'}];
 ctx.loadSpacePage.mockImplementation(async(slug:string)=>({page:ctx.spacePages.find(page=>page.slug===slug),version:{id:slug==='one'?'v1':'v2'}}));
 const host=document.createElement('div');const root=createRoot(host);
 try {
 await act(async()=>root.render(<MemoryRouter><SpaceWidgets/></MemoryRouter>));
 expect(Array.from(host.querySelectorAll('article')).map(node=>node.getAttribute('aria-label'))).toEqual(['Two widget','One widget']);
 expect(Array.from(host.querySelectorAll('iframe')).map(node=>node.dataset.size)).toEqual(['medium','small']);
 const first=host.querySelector('article')!;
 expect((first.querySelector('[aria-label="Move Two earlier"]') as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>{const select=first.querySelector('select')!;select.value='small';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(ctx.changeSpaceWidget).toHaveBeenLastCalledWith('two','small');
 await act(async()=>{(first.querySelector('[aria-label="Move Two later"]') as HTMLButtonElement).click();});
 expect(ctx.changeSpaceWidget).toHaveBeenLastCalledWith('two','later');
 await act(async()=>{Array.from(first.querySelectorAll('button')).find(button=>button.textContent==='Unpin')!.click();});
 expect(ctx.changeSpaceWidget).toHaveBeenLastCalledWith('two','unpin');
 ctx.spacePages=ctx.spacePages.map(page=>page.id==='one'?{...page,currentVersionId:'v3'}:page);
 await act(async()=>root.render(<MemoryRouter><SpaceWidgets/></MemoryRouter>));
 expect(host.querySelector('iframe[title="One"]')).toBeNull();
 } finally {await act(async()=>root.unmount());}
});
