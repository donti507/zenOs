import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {dailyLimit,usageDay} from './dailyUsage';
export const TTS_MAX_CHARS=600,TTS_MAX_BYTES=4*1024*1024;
export function loadTtsConfig(env:NodeJS.ProcessEnv=process.env){
 const baseUrl=(env.TTS_BASE_URL||'').trim().replace(/\/+$/,''),apiKey=(env.TTS_API_KEY||'').trim(),model=(env.TTS_MODEL||'').trim(),voice=(env.TTS_VOICE||'').trim();
 let valid=false;try{const url=new URL(baseUrl);valid=['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}
 return {baseUrl,apiKey,model,voice,enabled:valid&&!!apiKey&&!!model&&!!voice};
}
export function createTts(options:{env?:NodeJS.ProcessEnv;request?:typeof fetch;reserve?:(owner:string)=>Promise<boolean>;isPro?:(owner:string)=>Promise<boolean>;timeoutMs?:number}={}){
 const env=options.env||process.env,config=loadTtsConfig(env),request=options.request||fetch,limit=dailyLimit(env.DANTE_DAILY_LIMIT);
 const quotaReady=!!options.reserve||!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim());
 let client:SupabaseClient|undefined;const active=new Map<string,number>();
 const reserve=options.reserve||async function(owner:string){if(await options.isPro?.(owner))return true;client??=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await client.rpc('consume_tts_usage',{p_user_id:owner,p_limit:limit});if(error||typeof data?.[0]?.allowed!=='boolean')throw new Error('Speech usage unavailable');return data[0].allowed as boolean;};
 const enabled=config.enabled&&quotaReady;
 const handle:RequestHandler=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const owner=(req as any).userId;if(typeof owner!=='string'||owner.startsWith('anon:'))return res.status(401).json({error:'Sign in to use server speech.'});
  if(!enabled)return res.status(503).json({error:'Server speech is not configured. Browser voices remain available.'});
  const text=typeof req.body?.text==='string'?req.body.text.trim():'';
  if(!text||text.length>TTS_MAX_CHARS)return res.status(400).json({error:`Send one speech section of 1–${TTS_MAX_CHARS} characters.`});
  if((active.get(owner)||0)>=2)return res.status(429).json({error:'Server speech is busy. Browser voices remain available.'});
  active.set(owner,(active.get(owner)||0)+1);
  const abort=new AbortController();const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(options.timeoutMs||60000)]);
  const close=()=>{if(!res.writableEnded)abort.abort();};res.on('close',close);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   let allowed:boolean;try{allowed=await reserve(owner);}catch{return res.status(503).json({error:'Could not check today’s server speech limit. Browser voices remain available.'});}
   if(abort.signal.aborted)return;
   if(!allowed){const seconds=Math.max(1,Math.ceil((Date.parse(usageDay().resetsAt)-Date.now())/1000));res.setHeader('Retry-After',seconds);return res.status(429).json({error:'Daily server speech limit reached. Browser voices remain available.'});}
   const response=await request(config.baseUrl+'/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({model:config.model,input:text,voice:config.voice,response_format:'mp3'}),signal,redirect:'error'});
   const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(!response.ok||!response.body||!['audio/mpeg','audio/mp3','application/octet-stream'].includes(type)){await response.body?.cancel().catch(()=>{});throw new Error('Invalid speech response');}
   const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>TTS_MAX_BYTES){await response.body.cancel();throw new Error('Speech response too large');}
   reader=response.body.getReader();const first=await reader.read();if(first.done||!first.value.byteLength)throw new Error('Empty speech response');
   let total=0;const body=async function*(){let part=first;while(!part.done){total+=part.value.byteLength;if(total>TTS_MAX_BYTES)throw new Error('Speech response too large');yield part.value;part=await reader!.read();}};
   res.setHeader('Content-Type','audio/mpeg');
   await pipeline(Readable.from(body()),res,{signal});
  }catch{
   if(abort.signal.aborted||res.destroyed)return;
   if(res.headersSent)res.destroy();else res.status(502).json({error:'Server speech could not finish. Browser voices remain available.'});
  }finally{
   abort.abort();await reader?.cancel().catch(()=>{});res.off('close',close);const remaining=(active.get(owner)||1)-1;if(remaining>0)active.set(owner,remaining);else active.delete(owner);
  }
 };
 return {enabled,handle};
}
