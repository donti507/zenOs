import express from 'express';
import {afterEach,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createGallery,type GalleryStore} from '../gallery';
const id='10000000-0000-0000-0000-000000000001',version='20000000-0000-0000-0000-000000000001';let server:Server;
afterEach(()=>new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve()));
async function fixture(options:{admin?:boolean;confirmed?:boolean;visible?:boolean}={}){
 const now=new Date().toISOString();const row={id,title:'Timer',description:'Useful',author:'Alice',created_at:now,updated_at:now,html:'<h1>Timer</h1>',css:'',js:'',user_id:'PRIVATE_OWNER',source_page_id:'PRIVATE_PAGE',prompt:'PRIVATE_PROMPT'};
 const store:GalleryStore={list:vi.fn(async()=>[row]),detail:vi.fn(async()=>options.visible===false?null:row),mine:vi.fn(async()=>null),tree:vi.fn(async()=>[{...row,parent_id:null,depth:0}]),rpc:vi.fn(async()=>id),identity:vi.fn(async()=>({email:options.admin?'Admin@Example.com':'attacker@example.com',email_confirmed_at:options.confirmed===false?undefined:now}))};
 const gallery=createGallery({env:{ADMIN_EMAILS:'admin@example.com'},store});const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).userId=req.headers['x-owner']||'verified-user';next();});
 app.get('/',gallery.noCache,gallery.list);app.get('/page/:id',gallery.noCache,gallery.detail);app.get('/tree/:id',gallery.noCache,gallery.tree);app.post('/publish',gallery.signed,gallery.noCache,gallery.publish);app.post('/report/:id',gallery.signed,gallery.noCache,gallery.report);app.post('/admin/:id',gallery.signed,gallery.noCache,gallery.admin,gallery.moderate);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(path:string,body?:any,owner='verified-user')=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-owner':owner},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {call,store};
}
it('serves public snapshots using a field allowlist with no private identity/history fields',async()=>{
 const f=await fixture();for(const path of ['/','/page/'+id]){const response=await f.call(path);expect(response.status).toBe(200);const text=await response.text();expect(text).not.toContain('PRIVATE');expect(text).not.toContain('user_id');expect(response.headers.get('cache-control')).toBe('no-store');}
});
it('requires real authentication and explicit publishing consent, filters metadata and ignores body owners/code',async()=>{
 const f=await fixture();const body={pageId:id,versionId:version,title:'Timer',description:'Useful',author:'Alice',consent:true,user_id:'forged',html:'FORGED_CODE'};
 expect((await f.call('/publish',body,'anon:demo')).status).toBe(401);expect((await f.call('/publish',{...body,consent:false})).status).toBe(400);
 for(const title of ['<script>','FUCK','f\u200buck'])expect((await f.call('/publish',{...body,title})).status).toBe(400);
 expect((await f.call('/publish',body)).status).toBe(200);expect(f.store.rpc).toHaveBeenCalledExactlyOnceWith('publish_space_gallery',{p_user_id:'verified-user',p_page_id:id,p_version_id:version,p_title:'Timer',p_description:'Useful',p_author:'Alice'});
});
it('authorizes moderators only from the canonical confirmed email, rejecting client email/admin claims',async()=>{
 const f=await fixture();expect((await f.call('/admin/'+id,{action:'restore',email:'admin@example.com',isAdmin:true})).status).toBe(403);expect(f.store.rpc).not.toHaveBeenCalled();expect(f.store.identity).toHaveBeenCalledWith('verified-user');
});
it('denies unconfirmed admin emails',async()=>{
 const f=await fixture({admin:true,confirmed:false});expect((await f.call('/admin/'+id,{action:'hide'})).status).toBe(403);expect(f.store.rpc).not.toHaveBeenCalled();
});
it('requires explicit delete confirmation from a verified admin and uses fixed action names',async()=>{
 const f=await fixture({admin:true});expect((await f.call('/admin/'+id,{action:'delete'})).status).toBe(400);expect((await f.call('/admin/'+id,{action:'delete',confirm:true})).status).toBe(200);expect(f.store.rpc).toHaveBeenCalledWith('moderate_space_gallery',{p_id:id,p_action:'delete'});
});
it('does not return hidden snapshots/tree data and validates reports against the verified user',async()=>{
 const f=await fixture({visible:false});expect((await f.call('/page/'+id)).status).toBe(404);expect((await f.call('/tree/'+id)).status).toBe(404);expect(f.store.tree).not.toHaveBeenCalled();
 expect((await f.call('/report/'+id,{reason:'unsafe',user_id:'other'})).status).toBe(200);expect(f.store.rpc).toHaveBeenCalledWith('report_space_gallery',{p_user_id:'verified-user',p_id:id,p_reason:'unsafe'});
});
