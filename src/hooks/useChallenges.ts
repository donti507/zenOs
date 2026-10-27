import {useCallback,useEffect,useRef,useState} from 'react';
import type {Badge,BuildChallenge,ChallengeDetail} from '../../shared/challenges';
import {BADGES} from '../../shared/challenges';
import {listLocalSpaces} from '../lib/localSpaces';
import {localDateStr} from '../lib/utils';
import {LOCAL_BADGES_KEY,localBuildBadges} from '../lib/buildBadges';
type Options={ownerId:string|null;isOffline:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean;pageRevision:string};
export function useChallenges(options:Options){
 const [buildBadges,setBadges]=useState<Badge[]>([]);const badgeGeneration=useRef(0);
 const request=useCallback(async(path:string,body?:unknown,privateRequest=false,signal?:AbortSignal)=>{
  if(privateRequest&&(!options.ownerId||options.isOffline||!options.isCurrent()))throw new Error('Sign in to submit or vote in challenges.');
  const token=privateRequest?await options.getToken():null;if(privateRequest&&(!token||!options.isCurrent()))throw new Error('Your account changed.');
  const response=await fetch('/api/challenges'+path,{method:body===undefined?'GET':'POST',cache:'no-store',signal,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(privateRequest&&!options.isCurrent())throw new Error('Your account changed.');if(!response.ok)throw new Error(data.error||'Could not load challenges.');return data;
 },[options.ownerId,options.isOffline,options.getToken]);
 const refreshBuildBadges=useCallback(async()=>{
  const generation=++badgeGeneration.current;if(!options.ownerId||!options.isCurrent())return;
  let badges:Badge[];
  if(options.isOffline){const pages=await listLocalSpaces();if(!options.isCurrent()||generation!==badgeGeneration.current)return;let previous;try{previous=JSON.parse(localStorage.getItem(LOCAL_BADGES_KEY)||'null');}catch{}const saved=localBuildBadges(previous,localDateStr(new Date()),!!pages.length,pages.some(page=>!!page.remixSource));localStorage.setItem(LOCAL_BADGES_KEY,JSON.stringify(saved));badges=saved.badges;}
  else{const data=await request('/badges',undefined,true);badges=(data.badges||[]).filter((badge:any)=>Object.hasOwn(BADGES,badge?.key)&&typeof badge.earnedAt==='string');}
  if(options.isCurrent()&&generation===badgeGeneration.current)setBadges(badges);
 },[request,options.ownerId,options.isOffline]);
 useEffect(()=>{
  setBadges([]);let active=true;let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{if(active&&document.visibilityState==='visible')void refreshBuildBadges().catch(()=>{});};
  const schedule=()=>{const now=new Date();const next=options.isOffline?new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime():Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1);timer=setTimeout(()=>{refresh();schedule();},next-Date.now()+500);};
  refresh();schedule();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return ()=>{active=false;++badgeGeneration.current;clearTimeout(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[refreshBuildBadges,options.pageRevision]);
 const listChallenges=useCallback(async(offset=0,signal?:AbortSignal):Promise<{challenges:BuildChallenge[];hasMore:boolean}>=>request('?offset='+offset,undefined,false,signal),[request]);
 const readChallenge=useCallback(async(id:string,signal?:AbortSignal):Promise<ChallengeDetail>=>request('/'+encodeURIComponent(id)+(options.ownerId&&!options.isOffline?'/account':''),undefined,!!options.ownerId&&!options.isOffline,signal),[request,options.ownerId,options.isOffline]);
 const createChallenge=useCallback(async(input:{id:string;title:string;description:string;startsAt:string;endsAt:string})=>request('',input,true),[request]);
 const challengePublications=useCallback(async():Promise<{id:string;title:string}[]>=>{const data=await request('/mine',undefined,true);return data.pages||[];},[request]);
 const submitChallenge=useCallback(async(id:string,pageId:string)=>request('/'+id+'/submit',{pageId},true),[request]);
 const voteChallenge=useCallback(async(id:string,entryId:string)=>request('/'+id+'/vote',{entryId,confirm:true},true),[request]);
 return {buildBadges,refreshBuildBadges,listChallenges,readChallenge,createChallenge,challengePublications,submitChallenge,voteChallenge};
}
