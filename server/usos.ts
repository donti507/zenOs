import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Request,Response,RequestHandler} from 'express';

export const USOS_STATE_TTL=10*60_000,USOS_HANDOFF_TTL=60_000;
const MAX_STATES=2000,SCOPES='email|studies|offline_access';
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
/** RFC 5849: encoded sorting preserves duplicate query/body parameters. */
export function oauthSignature(method:string,url:string,oauth:Record<string,string>,consumerSecret:string,tokenSecret='',body=new URLSearchParams()){
 const target=new URL(url);const pairs=[...target.searchParams,...body,...Object.entries(oauth)].filter(([key])=>key!=='oauth_signature').map(([key,value])=>[encode(key),encode(value)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
 const normalized=pairs.map(pair=>pair.join('=')).join('&');
 const base=[method.toUpperCase(),target.origin+target.pathname,normalized].map(encode).join('&');
 return createHmac('sha1',encode(consumerSecret)+'&'+encode(tokenSecret)).update(base).digest('base64');
}
export function sealUsosToken(value:string,key:Buffer,aad:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');
}
export function openUsosToken(value:string,key:Buffer,aad:string){
 const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1')throw new Error('Invalid encrypted token');
 const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[2],'base64url');if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted token');
 const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tag);return Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');
}
export function loadUsosConfig(env:NodeJS.ProcessEnv=process.env){
 const consumerKey=env.USOS_CONSUMER_KEY?.trim()||'',consumerSecret=env.USOS_CONSUMER_SECRET?.trim()||'',supabaseUrl=env.SUPABASE_URL?.trim()||'',serviceKey=env.SUPABASE_SERVICE_ROLE_KEY?.trim()||'';
 let base='',key:Buffer|undefined;try{const url=new URL(env.USOS_BASE_URL?.trim()||'');if(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash){url.pathname=url.pathname.replace(/\/?$/,'/');base=url.href;}}catch{}
 const rawKey=env.USOS_TOKEN_KEY?.trim()||'';const decoded=Buffer.from(rawKey,'base64');if(decoded.length===32&&decoded.toString('base64')===rawKey)key=decoded;
 let validSupabase=false;try{const url=new URL(supabaseUrl);validSupabase=['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}
 return {base,key,consumerKey,consumerSecret,supabaseUrl,serviceKey,enabled:!!(base&&key&&consumerKey&&consumerSecret&&validSupabase&&serviceKey)};
}
function origin(req:Request){const host=req.headers.host;if(host==='zenose.tech')return 'https://zenose.tech';if(host==='localhost:3000')return 'http://localhost:3000';throw new Failure('invalid_host');}
class Failure extends Error{constructor(public code:string){super('USOS authentication failed');}}
const equal=(left:string,right:string)=>{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const single=(value:unknown,max=2048)=>typeof value==='string'&&value.length>0&&value.length<=max?value:'';
const cookieName=(host:string)=>host.startsWith('https:')?'__Host-zenos_usos':'zenos_usos';
function browserCookie(req:Request,host:string){const matches=(req.headers.cookie||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieName(host)+'='));return matches.length===1?matches[0].slice(cookieName(host).length+1):'';}
function cookie(res:Response,host:string,value:string,age:number){res.cookie(cookieName(host),value,{httpOnly:true,secure:host.startsWith('https:'),sameSite:'lax',path:'/',maxAge:age});}
const noStore:RequestHandler=(_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();};
export type UsosRow={id?:string;usos_user_id:string;user_id:string;usos_base_url:string;usos_access_token:string;usos_access_secret:string};
export interface UsosStore{
 byIdentity(id:string):Promise<UsosRow|null>;
 byOwner(id:string):Promise<{usos_user_id:string}|null>;
 emailOwner(email:string):Promise<{id:string;email:string;confirmed:boolean}|null>;
 save(row:UsosRow):Promise<void>;
 remove(owner:string):Promise<void>;
}
function databaseStore(client:SupabaseClient):UsosStore{
 return {
  async byIdentity(id){const {data,error}=await client.from('usos_accounts').select('*').eq('usos_user_id',id).maybeSingle();if(error)throw new Failure('unavailable');return data;},
  async byOwner(id){const {data,error}=await client.from('usos_accounts').select('usos_user_id').eq('user_id',id).maybeSingle();if(error)throw new Failure('unavailable');return data;},
  async emailOwner(email){const {data,error}=await client.rpc('find_usos_email_owner',{p_email:email});if(error||!Array.isArray(data)||data.length>1)throw new Failure('unavailable');return data[0]||null;},
  async save(row){const {error}=await client.rpc('save_usos_account',{p_usos_id:row.usos_user_id,p_user_id:row.user_id,p_base:row.usos_base_url,p_token:row.usos_access_token,p_secret:row.usos_access_secret});if(error)throw new Failure('already_linked');},
  async remove(owner){const {error}=await client.from('usos_accounts').delete().eq('user_id',owner);if(error)throw new Failure('unavailable');},
 };
}
type State={secret:string;browser:string;host:string;expires:number;owner:string|null};
type Handoff={hash:string;browser:string;host:string;expires:number};
export function createUsos(options:{env?:NodeJS.ProcessEnv;request?:typeof fetch;client?:SupabaseClient;store?:UsosStore;now?:()=>number}={}){
 const config=loadUsosConfig(options.env),request=options.request||fetch,now=options.now||Date.now;
 let client=options.client,store=options.store;const db=()=>client??=createClient(config.supabaseUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});const storage=()=>store??=databaseStore(db());
 const states=new Map<string,State>(),handoffs=new Map<string,Handoff>(),limits=new Map<string,{count:number;expires:number}>();
 const prune=()=>{for(const map of [states,handoffs,limits])for(const [key,row] of map)if(row.expires<=now())map.delete(key);};
 const limited=(req:Request,kind:string,max:number)=>{prune();const key=kind+':'+req.ip;let row=limits.get(key);if(!row){if(limits.size>=10000)throw new Failure('rate_limited');row={count:0,expires:now()+60000};limits.set(key,row);}if(++row.count>max)throw new Failure('rate_limited');};
 const gate=()=>{if(!config.enabled)throw new Failure('disabled');};
 const redirectError=(res:Response,error:unknown)=>res.redirect(303,'/?usos_error='+(error instanceof Failure?error.code:'unavailable'));
 async function verified(req:Request){const header=req.headers.authorization||'',token=header.startsWith('Bearer ')?header.slice(7):'';if(!token)throw new Failure('sign_in_required');const {data,error}=await db().auth.getUser(token);if(error||!data?.user?.id)throw new Failure('sign_in_required');return data.user;}
 async function read(response:globalThis.Response){if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Failure('unavailable');}const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)throw new Failure('unavailable');chunks.push(part.value);}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}}
 async function call(path:string,method:string,token='',secret='',extra:Record<string,string>={},body=new URLSearchParams()){
  const url=new URL(path,config.base);const oauth={oauth_consumer_key:config.consumerKey,oauth_nonce:randomBytes(24).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(Math.floor(now()/1000)),oauth_version:'1.0',...(token?{oauth_token:token}:{}),...extra};
  const signature=oauthSignature(method,url.href,oauth,config.consumerSecret,secret,body);const authorization='OAuth '+Object.entries({...oauth,oauth_signature:signature}).sort().map(([key,value])=>encode(key)+'="'+encode(value)+'"').join(', ');
  return read(await request(url.href,{method,headers:{Authorization:authorization,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:body.toString()}:{}),signal:AbortSignal.timeout(15000),redirect:'error'}));
 }
 function tokenPair(text:string,confirmed=false){const values=new URLSearchParams(text),token=values.get('oauth_token')||'',secret=values.get('oauth_token_secret')||'';if(values.getAll('oauth_token').length!==1||values.getAll('oauth_token_secret').length!==1||!single(token)||!single(secret)||(confirmed&&values.get('oauth_callback_confirmed')!=='true'))throw new Failure('unavailable');return {token,secret};}
 async function begin(req:Request,res:Response,owner:string|null){const host=origin(req);limited(req,'start',10);gate();prune();if(states.size>=MAX_STATES)throw new Failure('rate_limited');const browser=randomBytes(32).toString('base64url');const pair=tokenPair(await call('services/oauth/request_token','POST','','',{oauth_callback:host+'/api/auth/usos/callback'},new URLSearchParams({scopes:SCOPES})),true);
  if(states.has(pair.token))throw new Failure('unavailable');states.set(pair.token,{secret:pair.secret,browser,host,expires:now()+USOS_STATE_TTL,owner});cookie(res,host,browser,USOS_STATE_TTL);
  const authorize=new URL('services/oauth/authorize',config.base);authorize.searchParams.set('oauth_token',pair.token);return authorize.href;
 }
 const start:RequestHandler=async(req,res)=>{try{res.redirect(303,await begin(req,res,null));}catch(error){redirectError(res,error);}};
 const connect:RequestHandler=async(req,res)=>{try{const host=origin(req);if(req.headers.origin&&req.headers.origin!==host)throw new Failure('csrf');gate();limited(req,'connect',10);const user=await verified(req);res.json({url:await begin(req,res,user.id)});}catch(error){res.status(error instanceof Failure&&error.code==='sign_in_required'?401:400).json({error:error instanceof Failure?error.code:'unavailable'});}};
 const callback:RequestHandler=async(req,res)=>{let host:string|undefined,consumed=false;let created:string|undefined;
  try{
   host=origin(req);limited(req,'callback',30);gate();const token=single(req.query.oauth_token)||single(req.query.denied);const state=states.get(token);if(!state||state.expires<=now()){states.delete(token);throw new Failure('expired');}
   if(state.host!==host||!equal(browserCookie(req,host),state.browser))throw new Failure('csrf');states.delete(token);consumed=true;
   if(req.query.denied||req.query.oauth_problem||req.query.error)throw new Failure('denied');
   const verifier=single(req.query.oauth_verifier);if(!verifier)throw new Failure('denied');
   const access=tokenPair(await call('services/oauth/access_token','POST',token,state.secret,{oauth_verifier:verifier}));
   const raw=await call('services/users/user?fields='+encode('id|first_name|last_name|email|student_number'),'GET',access.token,access.secret);let profile:any;try{profile=JSON.parse(raw);}catch{throw new Failure('unavailable');}
   const id=typeof profile.id==='number'?String(profile.id):profile.id;if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw new Failure('unavailable');
   const linked=await storage().byIdentity(id);let owner:string;
   if(linked){if(linked.usos_base_url!==config.base)throw new Failure('provider_mismatch');if(state.owner&&linked.user_id!==state.owner)throw new Failure('already_linked');owner=linked.user_id;}
   else{
    const supplied=typeof profile.email==='string'?profile.email.trim().toLowerCase():'';
    if(supplied&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplied)||supplied.length>254||supplied.endsWith('@users.zenose.tech')))throw new Failure('unavailable');
    const email=supplied||`usos-${id.toLowerCase()}@users.zenose.tech`;const existing=await storage().emailOwner(email);
    if(existing){if(!state.owner)throw new Failure('link_required');if(existing.id!==state.owner||!existing.confirmed)throw new Failure('account_mismatch');owner=state.owner;}
    else if(state.owner)owner=state.owner;
    else{const first=typeof profile.first_name==='string'?profile.first_name.slice(0,100):'',last=typeof profile.last_name==='string'?profile.last_name.slice(0,100):'';const {data,error}=await db().auth.admin.createUser({email,email_confirm:true,user_metadata:{full_name:[first,last].filter(Boolean).join(' '),provider:'usos'}});if(error||!data?.user?.id)throw new Failure('link_required');owner=data.user.id;created=owner;}
   }
   // Read the canonical Supabase destination, never a callback/body email or user ID.
   const {data:canonical,error}=await db().auth.admin.getUserById(owner);if(error||!canonical.user?.email)throw new Failure('unavailable');
   const prefix=`usos:${config.base}:${id}:${owner}:`;
   await storage().save({usos_user_id:id,user_id:owner,usos_base_url:config.base,usos_access_token:sealUsosToken(access.token,config.key!,prefix+'token'),usos_access_secret:sealUsosToken(access.secret,config.key!,prefix+'secret')});created=undefined;
   if(state.owner){cookie(res,host,'',0);return res.redirect(303,'/?usos_connected=1');}
   if(handoffs.size>=MAX_STATES)throw new Failure('rate_limited');
   const result=await db().auth.admin.generateLink({type:'magiclink',email:canonical.user.email,options:{redirectTo:host+'/auth/usos'}});const hash=result.data?.properties?.hashed_token;
   if(result.error||typeof hash!=='string'||!/^[a-zA-Z0-9_-]{32,256}$/.test(hash))throw new Failure('unavailable');
   const stateId=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url');handoffs.set(stateId,{hash:digest(hash),browser,host,expires:now()+USOS_HANDOFF_TTL});cookie(res,host,browser,USOS_HANDOFF_TTL);
   return res.redirect(303,'/auth/usos#'+new URLSearchParams({token_hash:hash,type:'magiclink',state:stateId}));
  }catch(error){
   if(created){try{const row=await storage().byOwner(created);if(!row)await db().auth.admin.deleteUser(created);}catch{/* Preserve an uncertain provisioned account rather than deleting a committed link. */}}
   if(consumed&&host)cookie(res,host,'',0);redirectError(res,error);
  }
 };
 const complete:RequestHandler=async(req,res)=>{try{const host=origin(req);limited(req,'complete',20);gate();if(req.headers.origin&&req.headers.origin!==host)throw new Failure('csrf');const stateId=single(req.body?.state,128),hash=single(req.body?.token_hash,256),state=handoffs.get(stateId);if(!state||state.expires<=now()){handoffs.delete(stateId);throw new Failure('expired');}if(state.host!==host||!equal(state.browser,browserCookie(req,host))||!equal(state.hash,digest(hash)))throw new Failure('csrf');handoffs.delete(stateId);cookie(res,host,'',0);res.json({ok:true});}catch(error){res.status(400).json({error:error instanceof Failure?error.code:'unavailable'});}};
 const account:RequestHandler=async(req,res)=>{try{gate();limited(req,'account',30);const user=await verified(req),row=await storage().byOwner(user.id);res.json({connected:!!row,...(row?{usosUserId:row.usos_user_id}:{})});}catch(error){res.status(error instanceof Failure&&error.code==='sign_in_required'?401:503).json({error:error instanceof Failure?error.code:'unavailable'});}};
 const disconnect:RequestHandler=async(req,res)=>{try{const host=origin(req);gate();limited(req,'disconnect',10);if(req.headers.origin&&req.headers.origin!==host)throw new Failure('csrf');const user=await verified(req);await storage().remove(user.id);for(const [key,state] of states)if(state.owner===user.id)states.delete(key);res.json({ok:true});}catch(error){res.status(error instanceof Failure&&error.code==='sign_in_required'?401:400).json({error:error instanceof Failure?error.code:'unavailable'});}};
 return {enabled:config.enabled,noStore,start,callback,connect,complete,account,disconnect};
}
