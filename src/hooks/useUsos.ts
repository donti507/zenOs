import {useCallback,useEffect,useRef,useState} from 'react';
import {useDanteStatus} from './useDanteStatus';
import {SUPABASE_CONFIGURED} from '../lib/supabase';
import {finishUsosAuth} from '../lib/usosAuth';
import {usosError} from '../../shared/usos';
export function useUsos(options:{owner:string|null;offline:boolean;getToken:()=>Promise<string|null>}){
 const status=useDanteStatus(),enabled=!!status?.usos&&SUPABASE_CONFIGURED;
 const latest=useRef(options);latest.current=options;
 const [account,setAccount]=useState<{owner:string;id:string}|null>(null),[error,setError]=useState('');const read=useRef(0);
 const current=()=>latest.current.owner===options.owner&&latest.current.offline===options.offline;
 const api=async(method:string,url='/api/auth/usos/account')=>{
  if(!enabled||!options.owner||options.offline||!current())throw new Error(usosError('sign_in_required'));
  const token=await options.getToken();if(!token||!current())throw new Error(usosError('sign_in_required'));
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{Authorization:`Bearer ${token}`}});const data=await response.json().catch(()=>({}));if(!current())throw new Error('Your account changed.');if(!response.ok)throw new Error(usosError(data.error));return data;
 };
 const refreshUsos=useCallback(async()=>{const version=++read.current;if(!enabled||!options.owner||options.offline)return;try{const data=await api('GET');if(version===read.current&&current()){setAccount(data.connected?{owner:options.owner,id:data.usosUserId}:null);setError('');}}catch{if(current()&&version===read.current)setError('Could not load the USOS connection. Please try again.');}},[enabled,options.owner,options.offline,options.getToken]);
 useEffect(()=>{setAccount(null);setError('');void refreshUsos();const focus=()=>void refreshUsos();window.addEventListener('focus',focus);return()=>{++read.current;window.removeEventListener('focus',focus);};},[refreshUsos]);
 const loginWithUsos=()=>{if(!enabled)throw new Error(usosError('disabled'));window.location.assign('/api/auth/usos/start');};
 const connectUsos=async()=>{const data=await api('POST','/api/auth/usos/connect');let url:URL;try{url=new URL(data.url);}catch{throw new Error(usosError('unavailable'));}if(url.protocol!=='https:'||url.username||url.password||!url.pathname.endsWith('/services/oauth/authorize')||!url.searchParams.get('oauth_token')||!current())throw new Error(usosError('unavailable'));window.location.assign(url.href);};
 const disconnectUsos=async()=>{await api('DELETE');if(current()){++read.current;setAccount(null);setError('');}};
 return {usosEnabled:enabled,usosConnected:!!account&&account.owner===options.owner&&!options.offline,usosError:error,refreshUsos,loginWithUsos,connectUsos,disconnectUsos,finishUsosLogin:finishUsosAuth};
}
