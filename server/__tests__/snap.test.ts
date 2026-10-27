import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { createSnapHandler, snapImageBody, visionConfig, DEFAULT_VISION_MODEL } from '../snap';
import { MAX_SNAP_BYTES } from '../../shared/snap';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const config={baseUrl:'https://vision.example/v1',apiKey:'SERVER_KEY',model:DEFAULT_VISION_MODEL,extraHeaders:{'X-Project':'fixture'},timeoutMs:60000};
const upstream=vi.fn();let server:Server;let base:string;
const reply=(content:unknown)=>new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'content-type':'application/json'}});
beforeAll(async()=>{
 const app=express();app.post('/api/snap',snapImageBody,createSnapHandler(config,upstream));
 server=await new Promise<Server>(resolve=>{const started=app.listen(0,'127.0.0.1',()=>resolve(started));});
 base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
beforeEach(()=>{config.baseUrl='https://vision.example/v1';upstream.mockReset().mockResolvedValue(reply(JSON.stringify({items:[{title:' Read chapter ',date:'2026-11-02',type:'task'}]})));});
const post=(body:Buffer|string=png,type='image/png')=>fetch(base+'/api/snap',{method:'POST',headers:{'content-type':type,authorization:'Bearer USER_TOKEN'},body});
it('sends only a server-built image_url message with the vision model and server key, then validates JSON',async()=>{
 const res=await post();expect(res.status).toBe(200);expect(await res.json()).toEqual({items:[{title:'Read chapter',date:'2026-11-02',type:'task'}]});
 const [url,request]=upstream.mock.calls[0];expect(url).toBe('https://vision.example/v1/chat/completions');
 expect(request.headers.Authorization).toBe('Bearer SERVER_KEY');expect(request.headers['X-Project']).toBe('fixture');
 const body=JSON.parse(request.body);expect(body.model).toBe(DEFAULT_VISION_MODEL);
 expect(body.messages[1].content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}});
 expect(request.body).not.toContain('USER_TOKEN');expect(res.headers.get('cache-control')).toBe('no-store');
});
it('rejects images over 5 MB before calling the model',async()=>{
 const res=await post(Buffer.concat([png,Buffer.alloc(MAX_SNAP_BYTES)]));expect(res.status).toBe(413);expect(upstream).not.toHaveBeenCalled();
});
it('rejects unsupported types, URL submissions, PDFs and mismatched signatures',async()=>{
 expect((await post('https://example.com/secret','application/json')).status).toBe(415);
 expect((await post('%PDF-1.7','application/pdf')).status).toBe(415);
 expect((await post('not an image')).status).toBe(400);
 expect((await post(png,'image/jpeg')).status).toBe(400);expect(upstream).not.toHaveBeenCalled();
});
it('handles fenced JSON and leaves uncertain dates blank for review',async()=>{
 upstream.mockResolvedValue(reply('```json\n{"items":[{"title":"Exam","date":"next Monday","type":"exam"}]}\n```'));
 expect(await (await post()).json()).toEqual({items:[{title:'Exam',date:'',type:'exam'}]});
});
it('rejects malformed or unsafe model results without echoing their content',async()=>{
 upstream.mockResolvedValue(reply('PRIVATE_DOCUMENT_CONTENT'));
 const res=await post();expect(res.status).toBe(502);expect(await res.text()).not.toContain('PRIVATE_DOCUMENT_CONTENT');
 upstream.mockResolvedValue(reply('{"items":[{"title":"X","date":"2026-11-01","type":"delete_everything"}]}'));
 expect((await post()).status).toBe(502);
});
it('reports configuration, provider limits and timeouts without leaking upstream data',async()=>{
 config.baseUrl='';expect((await post()).status).toBe(503);expect(upstream).not.toHaveBeenCalled();config.baseUrl='https://vision.example/v1';
 upstream.mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR',{status:429}));const res=await post();expect(res.status).toBe(429);expect(await res.text()).not.toContain('PRIVATE_PROVIDER_ERROR');
 upstream.mockRejectedValue(new DOMException('PRIVATE_TIMEOUT','TimeoutError'));expect((await post()).status).toBe(504);
});
it('uses the requested default vision model independently of the text model/provider',()=>{
 expect(visionConfig({LLM_PROVIDER:'gemini',LLM_BASE_URL:'https://example.com/v1/',LLM_API_KEY:'openai-key',LLM_MODEL:'text-only',GEMINI_API_KEY:'other'})).toMatchObject({model:DEFAULT_VISION_MODEL,baseUrl:'https://example.com/v1',apiKey:'openai-key'});
 expect(visionConfig({VISION_MODEL:'custom-vision'}).model).toBe('custom-vision');
});
