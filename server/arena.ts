import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {spaceSettings} from './space';
import {streamChat,type LLMConfig,type ChatMessage} from './llm';
import {arenaRequest,ARENA_OUTPUT_LIMIT,type ArenaEvent} from '../shared/arena';
export interface ArenaStore {
 create:(id:string,owner:string,models:[string,string])=>Promise<void>;
 complete:(id:string,owner:string)=>Promise<void>;
}
export function arenaStore(env:NodeJS.ProcessEnv):ArenaStore{
 const client=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY||'',{auth:{persistSession:false,autoRefreshToken:false}});
 return {
  async create(id,owner,models){const {error}=await client.from('space_arena_rounds').insert({id,user_id:owner,model_a:models[0],model_b:models[1]});if(error)throw new Error('Storage unavailable');},
  async complete(id,owner){const {data,error}=await client.from('space_arena_rounds').update({completed:true}).eq('id',id).eq('user_id',owner).select('id').single();if(error||!data)throw new Error('Storage unavailable');},
 };
}
export function createArena(options:{env?:NodeJS.ProcessEnv;store?:ArenaStore;stream?:(config:LLMConfig,messages:ChatMessage[],signal:AbortSignal)=>AsyncIterable<string>}={}){
 const env=options.env||process.env;
 const settings=spaceSettings({...env,SPACE_MODELS:env.ARENA_MODELS?.trim()||env.SPACE_MODELS});
 const problem=settings.problem||(settings.models.length<2?'Configure two or three ARENA_MODELS on the server.':null);
 const configured=!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&& (env.SUPABASE_ANON_KEY||env.VITE_SUPABASE_ANON_KEY));
 const authRequired=!(env.DANTE_ALLOW_ANONYMOUS==='true'||(!configured&&env.NODE_ENV!=='production'));
 const cloudReady=!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim());
 let store=options.store;
 const busy=new Map<string,symbol>();
 const status:RequestHandler=(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({ready:!problem,models:settings.models,problem,authRequired,cloudReady:cloudReady||!!options.store});};
 const prepare:RequestHandler=(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');const owner=(req as any).userId;
  if(typeof owner!=='string')return res.status(401).json({error:'Sign in to compare models.'});
  if(problem)return res.status(503).json({error:problem});
  if(!owner.startsWith('anon:')&&!cloudReady&&!options.store)return res.status(503).json({error:'Configure Arena storage on the server before comparing models.'});
  let input:ReturnType<typeof arenaRequest>;
  try{input=arenaRequest(req.body);if(input.models.some(model=>!settings.models.includes(model)))throw new Error('Choose models from the server allowlist.');}
  catch(error){return res.status(400).json({error:(error as Error).message});}
  if(busy.has(owner)||busy.size>=4)return res.status(409).json({error:'A comparison is already running. Try again shortly.'});
  const claim=Symbol();busy.set(owner,claim);
  const release=()=>{if(busy.get(owner)===claim)busy.delete(owner);res.off('close',release);res.off('finish',release);};
  res.on('close',release);res.on('finish',release);(req as any).arenaWork={...input,owner};next();
 };
 const compare:RequestHandler=async(req,res)=>{
  const abort=new AbortController();const close=()=>{if(!res.writableEnded)abort.abort();};res.on('close',close);
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  const work=(req as any).arenaWork;const id=randomUUID();
  const send=async(event:ArenaEvent)=>{
   abort.signal.throwIfAborted();if(!res.write(JSON.stringify(event)+'\n'))await once(res,'drain',{signal:abort.signal});
  };
  try{
   if(res.destroyed)return;
   if(!work.owner.startsWith('anon:')){store??=arenaStore(env);await store.create(id,work.owner,work.models);}
   abort.signal.throwIfAborted();
   res.status(200).set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
   heartbeat=setInterval(()=>{if(!abort.signal.aborted&&res.writableLength<65536)res.write('{"type":"ping"}\n');},10000);heartbeat.unref();
   const results=await Promise.all(work.models.map(async(model:string,side:0|1)=>{
    let output='';const modelAbort=new AbortController();const modelSignal=AbortSignal.any([abort.signal,modelAbort.signal]);
    try{
     for await(const text of (options.stream||streamChat)({...settings.base,model,maxTokens:2000},[{role:'system',content:'Answer the user’s prompt clearly. This is a model comparison; you have no app tools or access to app data.'},{role:'user',content:work.prompt}],modelSignal)){
      abort.signal.throwIfAborted();output+=text;if(output.length>ARENA_OUTPUT_LIMIT)throw new Error('Answer too long');if(text)await send({type:'delta',side,text});
     }
     abort.signal.throwIfAborted();if(!output.trim())throw new Error('Empty answer');await send({type:'done',side});return true;
    }catch{if(!abort.signal.aborted)await send({type:'error',side});return false;}finally{modelAbort.abort();}
   }));
   abort.signal.throwIfAborted();
   if(heartbeat)clearInterval(heartbeat);
   if(results.every(Boolean)){
    if(!work.owner.startsWith('anon:'))await store!.complete(id,work.owner);
    await send({type:'complete',id});
   }else await send({type:'finished'});
   res.end();
  }catch{
   if(!abort.signal.aborted&&!res.destroyed){if(!res.headersSent)res.status(503).json({error:'Could not save this comparison. Apply the latest migration and try again.'});else{res.write('{"type":"finished"}\n');res.end();}}
  }finally{if(heartbeat)clearInterval(heartbeat);res.off('close',close);abort.abort();}
 };
 return {status,prepare,compare};
}
