// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import SpaceFrame from '../SpaceFrame';
const ctx=vi.hoisted(()=>({state:{theme:'light'},stateRef:{current:{tasks:[{title:'PRIVATE_TASK'}]}},googleEvents:[],user:{id:'viewer'},checkSpaceAccess:vi.fn(async()=>true)}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
it('denies the public data bridge before permission lookups even if a snapshot claims grants',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const channels:any[]=[];
 vi.stubGlobal('MessageChannel',class {port1:any={postMessage:vi.fn(),close:vi.fn(),onmessage:null};port2:any={postMessage:vi.fn(),close:vi.fn()};constructor(){channels.push(this);}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const id='10000000-0000-0000-0000-000000000001',now=new Date().toISOString();
 const snapshot:any={page:{id,title:'Public',currentVersionId:id,permissions:{tasks:true,events:true},updatedAt:now},version:{id,pageId:id,html:'<h1>Public</h1>',css:'',js:'',createdAt:now}};
 try{
 await act(async()=>root.render(<SpaceFrame snapshot={snapshot} publicPreview/>));const frame=host.querySelector('iframe')!;expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
 frame.contentWindow!.postMessage=vi.fn();await act(async()=>frame.dispatchEvent(new Event('load')));
 const token=frame.getAttribute('srcdoc')!.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)![0];
 await act(async()=>channels.at(-1).port1.onmessage({data:{token}}));
 const port={postMessage:vi.fn(),close:vi.fn()};const event=new Event('message');Object.defineProperties(event,{source:{value:frame.contentWindow},origin:{value:'null'},ports:{value:[port]},data:{value:{type:'zen:read',token,method:'tasks'}}});
 await act(async()=>window.dispatchEvent(event));expect(ctx.checkSpaceAccess).not.toHaveBeenCalled();expect(port.postMessage).toHaveBeenCalledWith({ok:false,error:'Public gallery pages cannot access workspace data.'});expect(JSON.stringify(port.postMessage.mock.calls)).not.toContain('PRIVATE_TASK');
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it('drops a pending personal bridge reply when a workspace switches before the frame rerenders',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const channels:any[]=[];let resolve!:(value:boolean)=>void;
 ctx.checkSpaceAccess.mockReset().mockImplementation(()=>new Promise<boolean>(done=>resolve=done));
 vi.stubGlobal('MessageChannel',class {port1:any={postMessage:vi.fn(),close:vi.fn(),onmessage:null};port2:any={postMessage:vi.fn(),close:vi.fn()};constructor(){channels.push(this);}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const id='10000000-0000-0000-0000-000000000001',now=new Date().toISOString();
 const snapshot:any={page:{id,title:'Private',currentVersionId:id,permissions:{tasks:true,events:true},updatedAt:now},version:{id,pageId:id,html:'<h1>Private</h1>',css:'',js:'',createdAt:now}};
 try{
 await act(async()=>root.render(<SpaceFrame snapshot={snapshot}/>));const frame=host.querySelector('iframe')!;frame.contentWindow!.postMessage=vi.fn();await act(async()=>frame.dispatchEvent(new Event('load')));
 const token=frame.getAttribute('srcdoc')!.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)![0];await act(async()=>channels.at(-1).port1.onmessage({data:{token}}));
 const port={postMessage:vi.fn(),close:vi.fn()};const event=new Event('message');Object.defineProperties(event,{source:{value:frame.contentWindow},origin:{value:'null'},ports:{value:[port]},data:{value:{type:'zen:read',token,method:'tasks'}}});await act(async()=>window.dispatchEvent(event));expect(ctx.checkSpaceAccess).toHaveBeenCalledTimes(1);
 (ctx.stateRef.current as any).workspaceId='team';await act(async()=>resolve(true));expect(port.postMessage).not.toHaveBeenCalled();expect(port.close).toHaveBeenCalled();
 }finally{delete (ctx.stateRef.current as any).workspaceId;await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
