// @vitest-environment jsdom
import React,{act} from 'react';
import 'fake-indexeddb/auto';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useGallery} from '../useGallery';
import {readLocalSpace,localSpaceHistory} from '../../lib/localSpaces';
let root:Root,api:ReturnType<typeof useGallery>;
const now=new Date().toISOString(),source='10000000-0000-0000-0000-000000000001',id='10000000-0000-0000-0000-000000000002',version='20000000-0000-0000-0000-000000000001';
const publicPage={id:source,title:'Timer',description:'Public description',author:'Alice',html:'<h1>Public timer</h1>',css:'h1{font-size:2rem}',js:'',createdAt:now,updatedAt:now};
const refresh=vi.fn(async()=>{});const token=vi.fn(async()=> 'verified-token');
let current=true;
function Harness({owner='local',offline=true}:{owner?:string;offline?:boolean}){api=useGallery({ownerId:owner,isOffline:offline,getToken:token,isCurrent:()=>current,refreshSpacePages:refresh});return null;}
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;current=true;vi.clearAllMocks();await new Promise<void>(resolve=>{indexedDB.deleteDatabase('zenos-spaces').onsuccess=()=>resolve();});root=createRoot(document.createElement('div'));vi.stubGlobal('fetch',vi.fn(async()=>Response.json({page:publicPage})));await act(async()=>root.render(<Harness/>));});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('remixes a public snapshot locally with immutable credit, a first save point and no data grants, with retry deduplication',async()=>{
 let result:any;await act(async()=>{result=await api.remixGalleryPage(source,'my-copy','My copy',id,version);});expect(result.page.remixSource).toEqual({id:source,title:'Timer',author:'Alice'});expect(result.page.permissions).toEqual({tasks:false,events:false});
 expect((await readLocalSpace(id)).version.html).toBe(publicPage.html);expect(await localSpaceHistory(id)).toHaveLength(1);
 await act(async()=>api.remixGalleryPage(source,'my-copy','My copy',id,version));expect(await localSpaceHistory(id)).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(1);expect(token).not.toHaveBeenCalled();
 await expect(api.publishGalleryPage(result,{title:'Timer',description:'',author:'Alice',consent:true})).rejects.toThrow('Sign in');
});
it('sends verified bearer credentials only for private actions and never sends public code or a body owner when publishing',async()=>{
 await act(async()=>root.render(<Harness owner="real" offline={false}/>));vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:source}));
 await api.publishGalleryPage({page:{id,currentVersionId:version},version:{id:version,html:'PRIVATE CODE'}} as any,{title:'Public title',description:'Description',author:'Public name',consent:true});
 const opts=vi.mocked(fetch).mock.calls.at(-1)![1]!;expect(opts.headers).toMatchObject({Authorization:'Bearer verified-token'});expect(JSON.parse(String(opts.body))).toEqual({pageId:id,versionId:version,title:'Public title',description:'Description',author:'Public name',consent:true});expect(String(opts.body)).not.toContain('PRIVATE');
});
it('does not create a local remix from a late response after account invalidation',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=api.remixGalleryPage(source,'late','Late',id,version);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));current=false;finish(Response.json({page:publicPage}));await expect(pending).rejects.toThrow('account changed');await expect(readLocalSpace(id)).rejects.toThrow();
});
