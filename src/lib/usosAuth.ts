import {supabase,SUPABASE_CONFIGURED} from './supabase';
import {usosError,USOS_ERRORS} from '../../shared/usos';
const pending=new Map<string,{expires:number;promise:Promise<void>}>();
/** Deduplicated for StrictMode; fragment credentials are never persisted or logged. */
export function finishUsosAuth(fragment:string,options:{client?:typeof supabase;request?:typeof fetch;configured?:boolean}={}):Promise<void>{
 const params=new URLSearchParams(fragment.replace(/^#/,''));const hash=params.get('token_hash')||'',state=params.get('state')||'';
 if(params.getAll('token_hash').length!==1||params.getAll('type').length!==1||params.getAll('state').length!==1||params.get('type')!=='magiclink'||!/^[a-zA-Z0-9_-]{32,256}$/.test(hash)||!/^[a-zA-Z0-9_-]{43}$/.test(state)||[...params.keys()].some(key=>!['token_hash','type','state'].includes(key)))return Promise.reject(new Error(usosError('expired')));
 if(!(options.configured??SUPABASE_CONFIGURED))return Promise.reject(new Error(usosError('disabled')));
 const key=state+':'+hash;for(const [key,entry] of pending)if(entry.expires<=Date.now())pending.delete(key);const existing=pending.get(key);if(existing)return existing.promise;
 if(pending.size>=8)pending.delete(pending.keys().next().value!);
 const promise=(async()=>{
  const response=await (options.request||fetch)('/api/auth/usos/complete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,token_hash:hash}),cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(usosError(data.error));}
  const {data,error}=await (options.client||supabase).auth.verifyOtp({token_hash:hash,type:'magiclink'});
  if(error||!data.session)throw new Error(usosError('expired'));
 })().catch(error=>{if(error instanceof Error&&Object.values(USOS_ERRORS).includes(error.message))throw error;throw new Error(usosError('unavailable'));});
 pending.set(key,{expires:Date.now()+60000,promise});const clear=()=>pending.delete(key);void promise.then(clear,clear);return promise;
}
