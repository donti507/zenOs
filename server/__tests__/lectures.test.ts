import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLectures } from '../lectures';
let server:Server;let handlers:ReturnType<typeof createLectures>;
afterEach(async()=>{await handlers?.close();await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());});
const notes={summary:'Summary',keyPoints:['Point'],flashcards:Array.from({length:10},()=>({question:'Q',answer:'A',known:null})),actionItems:[{title:'Read chapter',taskId:null}]};
async function fixture(options:any={}){
 let root='';const prepare=vi.fn(async()=>{root=await mkdtemp(path.join(tmpdir(),'lecture-test-'));const chunks=[path.join(root,'0.wav'),path.join(root,'1.wav')];await Promise.all(chunks.map(file=>writeFile(file,Buffer.alloc(2000))));return {root,chunks,duration:300};});
 const transcribe=vi.fn(async()=> 'Lecture speech.');const analyze=vi.fn(async(_text:any,_signal:any,progress:any)=>{progress(0,1,'Creating notes');return notes;});
 handlers=createLectures({prepare,transcribe,analyze,ready:true,...options});const app=express();
 app.use((req,_res,next)=>{(req as any).userId=req.headers['x-user']||undefined;next();});
 let sttQuota=0,chatQuota=0;
 app.post('/prepare',handlers.prepare);app.post('/:id/chunk/:index',handlers.useJob,handlers.cachedChunk,(_req,_res,next)=>{sttQuota++;next();},handlers.chunk);
 app.post('/:id/analyze',handlers.useJob,handlers.cachedResult,(_req,_res,next)=>{chatQuota++;next();},handlers.analyze);app.delete('/:id',handlers.useJob,handlers.cancel);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(url:string,method='POST',user='owner')=>fetch(base+url,{method,headers:{'x-user':user,'content-type':'audio/wav'}});
 return {call,prepare,transcribe,analyze,root:()=>root,quota:()=>({sttQuota,chatQuota})};
}
it('binds jobs to verified identity, retries cached chunks/results without quota and removes temporary audio on cancel',async()=>{
 const f=await fixture();expect((await f.call('/prepare','POST','')).status).toBe(401);
 const job=await (await f.call('/prepare')).json();expect(job.chunks).toBe(2);
 expect((await f.call('/prepare')).status).toBe(409);expect((await f.call(`/${job.id}/chunk/0`,'POST','other')).status).toBe(404);
 expect((await f.call(`/${job.id}/chunk/-1`)).status).toBe(400);expect((await f.call(`/${job.id}/analyze`)).status).toBe(409);
 for(const index of [0,0,1])expect((await f.call(`/${job.id}/chunk/${index}`)).status).toBe(200);
 for(let i=0;i<2;i++){const response=await f.call(`/${job.id}/analyze`);expect(await response.text()).toContain('"type":"result"');}
 expect(f.transcribe).toHaveBeenCalledTimes(2);expect(f.analyze).toHaveBeenCalledTimes(1);expect(f.quota()).toEqual({sttQuota:2,chatQuota:1});
 expect((await f.call(`/${job.id}`,'DELETE')).status).toBe(204);await expect(access(f.root())).rejects.toThrow();expect((await f.call(`/${job.id}/analyze`)).status).toBe(404);
});
it('retains successful sections after a provider failure, and never echoes provider secrets',async()=>{
 let calls=0;const f=await fixture({transcribe:vi.fn(async()=>{if(++calls===2)throw new Error('secret-token');return 'Speech';})});const job=await(await f.call('/prepare')).json();
 await f.call(`/${job.id}/chunk/0`);const failed=await f.call(`/${job.id}/chunk/1`);expect(failed.status).toBe(502);expect(await failed.text()).not.toContain('secret-token');
 await f.call(`/${job.id}/chunk/0`);await f.call(`/${job.id}/chunk/1`);expect(calls).toBe(3);expect(f.quota().sttQuota).toBe(3);
});
it('rejects silent recordings before charging analysis and expires abandoned sessions',async()=>{
 const f=await fixture({transcribe:async()=>'',ttlMs:30});const job=await(await f.call('/prepare')).json();
 await f.call(`/${job.id}/chunk/0`);await f.call(`/${job.id}/chunk/1`);expect((await f.call(`/${job.id}/analyze`)).status).toBe(422);expect(f.quota().chatQuota).toBe(0);
 await new Promise(resolve=>setTimeout(resolve,45));expect((await f.call(`/${job.id}/chunk/0`)).status).toBe(404);
});
