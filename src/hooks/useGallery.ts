import {useCallback} from 'react';
import {galleryPage,type GalleryNode,type GalleryPage} from '../../shared/gallery';
import {spaceSnapshot,spaceSlug,spaceText,type SpaceSnapshot} from '../../shared/space';
import {createLocalSpace,listLocalSpaces,readLocalSpace} from '../lib/localSpaces';
type Options={ownerId:string|null;isOffline:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean;refreshSpacePages:()=>Promise<void>};
export function useGallery(options:Options){
 const request=useCallback(async(path:string,body?:unknown,privateRequest=false,signal?:AbortSignal)=>{
  if(privateRequest&&(!options.ownerId||options.isOffline||!options.isCurrent()))throw new Error('Sign in to use this gallery action.');
  const token=privateRequest?await options.getToken():null;
  if(privateRequest&&(!token||!options.isCurrent()))throw new Error('Your account changed. Sign in again.');
  const response=await fetch('/api/gallery'+path,{method:body===undefined?'GET':'POST',signal,cache:'no-store',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(privateRequest&&!options.isCurrent())throw new Error('Your account changed.');
  if(!response.ok)throw new Error(data.error||'Could not complete this gallery request.');return data;
 },[options.ownerId,options.isOffline,options.getToken]);
 const getGalleryStatus=useCallback(async()=>request('/status'),[request]);
 const getGalleryAccount=useCallback(async()=>!options.ownerId||options.isOffline?{isAdmin:false}:request('/account',undefined,true),[request,options.ownerId,options.isOffline]);
 const listGallery=useCallback(async(offset=0,admin=false,signal?:AbortSignal)=>{const data=await request((admin?'/admin':'')+'?offset='+offset,undefined,admin,signal);return {pages:(data.pages||[]).map((row:any)=>galleryPage(row)),hasMore:!!data.hasMore};},[request]);
 const readGalleryPage=useCallback(async(id:string,admin=false,signal?:AbortSignal):Promise<GalleryPage>=>{const data=await request((admin?'/admin/':'/')+encodeURIComponent(id),undefined,admin,signal);return galleryPage(data.page,true);},[request]);
 const getGalleryTree=useCallback(async(id:string,signal?:AbortSignal):Promise<GalleryNode[]>=>{const data=await request('/'+encodeURIComponent(id)+'/tree',undefined,false,signal);return data.nodes||[];},[request]);
 const ownGalleryPage=useCallback(async(id:string)=>{const data=await request('/mine/'+encodeURIComponent(id),undefined,true);return data.page?galleryPage(data.page):null;},[request]);
 const publishGalleryPage=useCallback(async(snapshot:SpaceSnapshot,metadata:{title:string;description:string;author:string;consent:boolean}):Promise<string>=>{const data=await request('/publish',{pageId:snapshot.page.id,versionId:snapshot.version.id,...metadata},true);return data.id;},[request]);
 const withdrawGalleryPage=useCallback(async(id:string)=>{await request('/'+id+'/withdraw',{},true);},[request]);
 const reportGalleryPage=useCallback(async(id:string,reason:string)=>{await request('/'+id+'/report',{reason},true);},[request]);
 const moderateGalleryPage=useCallback(async(id:string,action:string,confirm=false)=>{await request('/admin/'+id,{action,confirm},true);},[request]);
 const remixGalleryPage=useCallback(async(sourceId:string,slug:string,title:string,id:string,versionId:string)=>{
  if(!options.ownerId||!options.isCurrent())throw new Error('Open your workspace to remix a page.');
  slug=spaceSlug(slug);title=spaceText(title,80,'page title');let result:SpaceSnapshot;
  if(options.isOffline){const cached=(await listLocalSpaces()).find(page=>page.id===id&&page.remixSource?.id===sourceId);if(cached){if(!options.isCurrent())throw new Error('Your account changed.');await options.refreshSpacePages();return readLocalSpace(cached.id);}const source=await readGalleryPage(sourceId);if(!options.isCurrent())throw new Error('Your account changed.');result=await createLocalSpace(id,slug,title,versionId,{code:source,credit:{id:source.id,title:source.title,author:source.author,...(source.credit?{original:source.credit.original||{id:source.credit.id,title:source.credit.title,author:source.credit.author}}:{})}});}
  else{const data=await request('/'+sourceId+'/remix',{id,versionId,slug,title},true);result=spaceSnapshot(data.snapshot);}
  if(!options.isCurrent())throw new Error('Your account changed.');await options.refreshSpacePages();return result;
 },[request,readGalleryPage,options.ownerId,options.isOffline,options.refreshSpacePages]);
 return {getGalleryStatus,getGalleryAccount,listGallery,readGalleryPage,getGalleryTree,ownGalleryPage,publishGalleryPage,withdrawGalleryPage,reportGalleryPage,moderateGalleryPage,remixGalleryPage};
}
