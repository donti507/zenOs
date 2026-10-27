import {afterEach,expect,it,vi} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {createArena} from '../arena';
import {createDailyUsage} from '../dailyUsage';
let server:Server;
afterEach(()=>new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve()));
async function fixture(options:{deny?:boolean;stream?:any;completeFail?:boolean}={}){
 const store={create:vi.fn(async()=>{}),complete:vi.fn(async()=>{if(options.completeFail)throw Error('PRIVATE_DATABASE');})};
 const stream=options.stream||vi.fn(async function*(config:any){yield config.model+' first ';await new Promise(resolve=>setTimeout(resolve,5));yield 'second';});
 const arena=createArena({env:{LLM_BASE_URL:'https://fixture',LLM_MODEL:'alpha',ARENA_MODELS:'alpha,beta'},store,stream});
 const rpc=vi.fn(async()=>({data:[{allowed:!options.deny,date:'2026-10-27',messages:options.deny?19:2,transcriptions:0}],error:null}));
 const daily=createDailyUsage({key:'service',client:()=>({rpc}) as any});const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).userId='verified-user';next();});
 app.post('/',arena.prepare,daily.count('messages',2),arena.compare);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(body:any={},signal?:AbortSignal)=>fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Explain a timer',models:['alpha','beta'],...body})});
 return {call,store,stream,rpc};
}
it('streams both allowed models independently and marks the verified owner round complete before allowing a vote',async()=>{
 const f=await fixture();const response=await f.call({user_id:'foreign',url:'https://foreign',cost:0});expect(response.headers.get('content-type')).toContain('ndjson');
 const reader=response.body!.getReader();const first=await reader.read();expect(new TextDecoder().decode(first.value)).toContain('delta');let text=new TextDecoder().decode(first.value);while(true){const {value,done}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);}
 const events=text.trim().split('\n').map(line=>JSON.parse(line));expect(events.filter(event=>event.type==='done')).toHaveLength(2);expect(events.at(-1).type).toBe('complete');
 expect(f.store.create).toHaveBeenCalledWith(events.at(-1).id,'verified-user',['alpha','beta']);expect(f.store.complete).toHaveBeenCalledWith(events.at(-1).id,'verified-user');
 expect(f.rpc).toHaveBeenCalledExactlyOnceWith('consume_dante_usage_amount',{p_user_id:'verified-user',p_kind:'messages',p_limit:20,p_amount:2});expect(f.stream).toHaveBeenCalledTimes(2);
});
it('validates identical/foreign models and prompts before quota reservation and never calls providers when only one message remains',async()=>{
 const f=await fixture({deny:true});for(const body of [{models:['alpha','alpha']},{models:['alpha','foreign']},{prompt:''},{prompt:'x'.repeat(2001)}])expect((await f.call(body)).status).toBe(400);
 expect(f.rpc).not.toHaveBeenCalled();expect((await f.call()).status).toBe(429);expect(f.stream).not.toHaveBeenCalled();expect(f.store.create).not.toHaveBeenCalled();
});
it('keeps the other answer streaming on a model error and never leaks provider secrets or enables voting',async()=>{
 const f=await fixture({stream:vi.fn(async function*(config:any){if(config.model==='alpha')throw Error('PRIVATE_PROVIDER_KEY');yield 'Safe beta answer';})});
 const response=await f.call();const text=await response.text();expect(text).not.toContain('PRIVATE_PROVIDER_KEY');expect(text).toContain('Safe beta answer');expect(text).toContain('"type":"error"');expect(text).not.toContain('"type":"complete"');expect(f.store.complete).not.toHaveBeenCalled();
});
it('withholds voting if persistence fails even after both models finish',async()=>{
 const f=await fixture({completeFail:true});const text=await(await f.call()).text();expect(text).not.toContain('PRIVATE_DATABASE');expect(text).not.toContain('"type":"complete"');expect(text).toContain('"type":"finished"');
});
it('cancels both upstream streams on disconnect and rejects a concurrent round before charging',async()=>{
 const signals:AbortSignal[]=[];const f=await fixture({stream:vi.fn(async function*(_config:any,_messages:any,signal:AbortSignal){signals.push(signal);yield 'first';await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));})});
 const abort=new AbortController();const response=await f.call({},abort.signal);await response.body!.getReader().read();expect((await f.call()).status).toBe(409);expect(f.rpc).toHaveBeenCalledTimes(1);
 abort.abort();await vi.waitFor(()=>expect(signals.every(signal=>signal.aborted)).toBe(true));expect(signals).toHaveLength(2);expect(f.store.complete).not.toHaveBeenCalled();
});
