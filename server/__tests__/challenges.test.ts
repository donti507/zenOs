import express from 'express';
import {afterEach,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createChallenges,type ChallengeStore} from '../challenges';
import {createGallery,type GalleryStore} from '../gallery';
const id='10000000-0000-0000-0000-000000000001',entry='20000000-0000-0000-0000-000000000001';let server:Server;
afterEach(()=>new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve()));
async function fixture(admin=false,confirmed=true){
 const store:ChallengeStore={rpc:vi.fn(async(name:string)=>name==='space_challenge_detail'?{challenge:{id},entries:[],myVote:null,myEntry:null}:name==='refresh_space_badges'?[{badge:'first_page',created_at:'2026-10-27',user_id:'PRIVATE'},{badge:'forged',created_at:'2026-10-27'}]:entry),list:vi.fn(async()=>[{id,title:'Build',description:'Timer',starts_at:'2026-10-27',ends_at:'2026-11-03',finalized:false,user_id:'PRIVATE'}]),create:vi.fn(async()=>id),mine:vi.fn(async()=>[{id,title:'Page'}])};
 const galleryStore:GalleryStore={list:vi.fn(),detail:vi.fn(),mine:vi.fn(),tree:vi.fn(),rpc:vi.fn(),identity:vi.fn(async()=>({email:admin?'admin@example.com':'other@example.com',email_confirmed_at:confirmed?'2026-10-27':undefined}))};
 const gallery=createGallery({env:{ADMIN_EMAILS:'admin@example.com'},store:galleryStore}),handler=createChallenges({store});const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).userId=req.headers['x-owner']||'verified';next();});
 app.get('/',gallery.noCache,handler.list);app.get('/badges',gallery.signed,gallery.noCache,handler.badges);app.get('/:id/account',gallery.signed,gallery.noCache,handler.myDetail);app.get('/:id',gallery.noCache,handler.detail);
 app.post('/',gallery.signed,gallery.admin,handler.create);app.post('/:id/submit',gallery.signed,handler.submit);app.post('/:id/vote',gallery.signed,handler.vote);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(path:string,body?:any,owner='verified')=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-owner':owner},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{store,call};
}
it('returns public metadata without owners and only scopes private reads to the verified token',async()=>{
 const f=await fixture();const response=await f.call('/');expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('PRIVATE');
 await f.call('/'+id+'?user_id=forged');expect(f.store.rpc).toHaveBeenCalledWith('space_challenge_detail',{p_id:id,p_user_id:null});
 await f.call('/'+id+'/account?user_id=forged');expect(f.store.rpc).toHaveBeenCalledWith('space_challenge_detail',{p_id:id,p_user_id:'verified'});
});
it('requires canonical verified admin access for creation, rejecting spoofed client claims',async()=>{
 const f=await fixture();expect((await f.call('/',{id,isAdmin:true,email:'admin@example.com'})).status).toBe(403);expect(f.store.create).not.toHaveBeenCalled();
});
it('rejects unconfirmed admin accounts',async()=>{const f=await fixture(true,false);expect((await f.call('/',{id})).status).toBe(403);});
it('validates dates and text, fixes the creator from auth and permits safe retries with an ID',async()=>{
 const f=await fixture(true);const startsAt=new Date(Date.now()+86400000).toISOString(),endsAt=new Date(Date.now()+8*86400000).toISOString();const input={id,title:'Timer week',description:'Build a useful timer',startsAt,endsAt,user_id:'forged'};
 expect((await f.call('/',input)).status).toBe(200);expect(f.store.create).toHaveBeenCalledWith('verified',{title:input.title,description:input.description,startsAt,endsAt},id);
 for(const patch of [{title:'<b>bad</b>'},{description:'FUCK'},{endsAt:startsAt},{startsAt:'bad'},{endsAt:new Date(Date.now()+40*86400000).toISOString()}])expect((await f.call('/',{...input,...patch})).status).toBe(400);
});
it('requires real accounts and confirmed votes; ignores body ownership, dates and vote counts',async()=>{
 const f=await fixture();expect((await f.call('/'+id+'/submit',{pageId:entry},'anon:demo')).status).toBe(401);
 expect((await f.call('/'+id+'/vote',{entryId:entry})).status).toBe(400);
 expect((await f.call('/'+id+'/vote',{entryId:entry,confirm:true,user_id:'forged',votes:100})).status).toBe(200);expect(f.store.rpc).toHaveBeenCalledWith('vote_space_challenge',{p_user_id:'verified',p_challenge_id:id,p_entry_id:entry});
 await f.call('/'+id+'/submit',{pageId:entry,user_id:'forged',endsAt:'2099-01-01'});expect(f.store.rpc).toHaveBeenCalledWith('submit_space_challenge',{p_user_id:'verified',p_challenge_id:id,p_gallery_id:entry});
});
it('returns only valid earned badge fields and never accepts a browser activity date',async()=>{
 const f=await fixture();expect(await(await f.call('/badges?day=2099-01-01')).json()).toEqual({badges:[{key:'first_page',earnedAt:'2026-10-27'}]});expect(f.store.rpc).toHaveBeenCalledWith('refresh_space_badges',{p_user_id:'verified'});
});
