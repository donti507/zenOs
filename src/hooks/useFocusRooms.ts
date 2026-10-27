import {useCallback,useEffect,useRef,useState} from 'react';
import type {RealtimeChannel} from '@supabase/supabase-js';
import {supabase} from '../lib/supabase';
import {focusSnapshot,focusPresenceIds,focusTopic,type FocusSample} from '../../shared/focusRooms';
import {isSpaceId} from '../../shared/space';
import {galleryText} from '../../shared/gallery';
type Options={ownerId:string|null;isOffline:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean};
type Connection={id:string;sessionId:string;name:string;timeZone:string};
class RoomRequestError extends Error{constructor(message:string,public status:number){super(message);}}
export function useFocusRooms(options:Options){
 const [connection,setConnection]=useState<Connection|null>(null),[focusRoom,setRoom]=useState<FocusSample|null>(null),[focusPresence,setPresence]=useState<Set<string>>(new Set());
 const [focusRoomStatus,setStatus]=useState<'idle'|'joining'|'connected'|'reconnecting'|'error'>('idle'),[focusRoomError,setError]=useState('');
 const pendingRemoval=useRef<Promise<unknown>>(Promise.resolve());
 const generation=useRef(0),sample=useRef<FocusSample|null>(null),refresh=useRef<()=>Promise<void>>(async()=>{});
 const signed=!!options.ownerId&&!options.isOffline;
 const request=useCallback(async(path:string,body?:unknown,signal?:AbortSignal)=>{
  if(!options.ownerId||options.isOffline||!options.isCurrent())throw new Error('Sign in to use Focus Rooms.');
  const token=await options.getToken();if(!token||!options.isCurrent())throw new Error('Your account changed. Sign in again.');
  const response=await fetch('/api/focus-rooms'+path,{method:body===undefined?'GET':'POST',signal,cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!options.isCurrent())throw new Error('Your account changed.');if(!response.ok)throw new RoomRequestError(data.error||'Could not reach this Focus Room.',response.status);return data;
 },[options.ownerId,options.isOffline,options.getToken]);
 const leaveFocusRoom=useCallback(()=>{++generation.current;sample.current=null;setConnection(null);setRoom(null);setPresence(new Set());setStatus('idle');setError('');},[]);
 useEffect(()=>{leaveFocusRoom();},[options.ownerId,options.isOffline,leaveFocusRoom]);
 const joinFocusRoom=useCallback((id:string,name:string)=>{
  if(!signed||!options.isCurrent())throw new Error('Sign in to join a Focus Room.');if(!isSpaceId(id))throw new Error('Invalid invite link.');
  const label=galleryText(name,40,'display name');setError('');setStatus('joining');setConnection({id,sessionId:crypto.randomUUID(),name:label,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'});
 },[signed,options.ownerId,options.isOffline]);
 useEffect(()=>{
  if(!connection||!signed)return;const scope=++generation.current;let active=true,channel:RealtimeChannel|undefined,credential:string|null=null,joined=false,reading=false,queued=false,queuedHeartbeat=false,removed=false,presenceReady=false;
  const abort=new AbortController();const current=()=>active&&generation.current===scope&&options.isCurrent();
  const closeChannel=()=>{if(channel&&!removed){removed=true;pendingRemoval.current=supabase.removeChannel(channel).catch(()=>{});}};
  sample.current=null;setRoom(null);setPresence(new Set());setStatus('joining');setError('');
  const apply=(data:unknown,started:number)=>{if(!current())return;const parsed=focusSnapshot(data);if(sample.current&&(parsed.room.revision<sample.current.room.revision||Date.parse(parsed.serverNow)<Date.parse(sample.current.serverNow)))return;const receivedAt=performance.now();const value={...parsed,receivedAt,serverTime:Date.parse(parsed.serverNow)+Math.min(2000,Math.max(0,receivedAt-started)/2)};sample.current=value;setRoom(value);};
  const disconnected=(error:unknown)=>{
   if(!current())return;setError(error instanceof Error?error.message:'Room connection lost.');setPresence(new Set());
   if(error instanceof RoomRequestError&&[401,403,404].includes(error.status)){setStatus('error');sample.current=null;setRoom(null);active=false;abort.abort();closeChannel();}
   else setStatus('reconnecting');
  };
  const reconcile=async(heartbeat=false)=>{
   if(!current()||!joined)return;if(reading){queued=true;queuedHeartbeat ||= heartbeat;return;}reading=true;
   try{const started=performance.now();const data=await request('/'+connection.id+(heartbeat?'/heartbeat':''),heartbeat?{sessionId:connection.sessionId}:undefined,abort.signal);apply(data,started);if(current()&&presenceReady&&channel?.state==='joined'){setPresence(focusPresenceIds(channel.presenceState()));setError('');setStatus('connected');}}
   catch(error){disconnected(error);}finally{reading=false;if(queued&&current()){queued=false;const renew=queuedHeartbeat;queuedHeartbeat=false;void reconcile(renew);}}
  };
  refresh.current=()=>reconcile(true);
  void (async()=>{
   try{
    credential=await options.getToken();if(!current())return;
    const started=performance.now();const data=await request('/'+connection.id+'/join',{sessionId:connection.sessionId,name:connection.name,timeZone:connection.timeZone},abort.signal);joined=true;
    if(!current())return;apply(data,started);await supabase.realtime.setAuth(credential||undefined);await pendingRemoval.current;if(!current())return;
    channel=supabase.channel(focusTopic(connection.id),{config:{private:true,presence:{key:connection.sessionId}}})
     .on('presence',{event:'sync'},()=>{if(current()&&channel){setPresence(focusPresenceIds(channel.presenceState()));void reconcile();}})
     .on('broadcast',{event:'timer'},()=>{if(current())void reconcile();})
     .subscribe(status=>{
      if(!current())return;
      if(status==='SUBSCRIBED')void (async()=>{try{const result=await channel!.track({sessionId:connection.sessionId});if(!current())return;if(result!=='ok')throw new Error('Presence could not connect. Retry joining the room.');presenceReady=true;await reconcile(true);}catch(error){disconnected(error);}})();
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){presenceReady=false;setStatus('reconnecting');setPresence(new Set());setError('Live connection lost. Reconnecting…');}
     });
   }catch(error){disconnected(error);}
  })();
  const heartbeat=setInterval(()=>{if(current())void reconcile(true);},30000);
  const onFocus=()=>{if(document.visibilityState==='visible')void reconcile(true);};window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
  return ()=>{
   active=false;++generation.current;abort.abort();clearInterval(heartbeat);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);refresh.current=async()=>{};
   closeChannel();
   // The captured token always belongs to this session's owner, even after account changes.
   if(credential)void fetch('/api/focus-rooms/'+connection.id+'/leave',{method:'POST',keepalive:true,headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({sessionId:connection.sessionId})}).catch(()=>{});
  };
 },[connection,signed,request,options.ownerId]);
 const listFocusRooms=useCallback(async(signal?:AbortSignal):Promise<{id:string;title:string;lastActiveAt:string}[]>=>{const data=await request('',undefined,signal);return data.rooms||[];},[request]);
 const createFocusRoom=useCallback(async(id:string,title:string):Promise<string>=>{const data=await request('',{id,title:galleryText(title,80,'room title')});return data.id;},[request]);
 const controlFocusRoom=useCallback(async(action:'start'|'pause'|'reset')=>{
  const before=sample.current,scope=generation.current;if(!before||!before.room.isHost||focusRoomStatus!=='connected')throw new Error('Only the connected host can control this timer.');
  try{await request('/'+before.room.id+'/control',{action,revision:before.room.revision});if(scope===generation.current)await refresh.current();}
  catch(error){if(scope===generation.current){await refresh.current();setError(error instanceof Error?error.message:'Timer change was not confirmed.');}throw error;}
 },[request,focusRoomStatus]);
 const refreshFocusRoom=useCallback(()=>refresh.current(),[]);
 return {focusRoom,focusPresence,focusRoomStatus,focusRoomError,listFocusRooms,createFocusRoom,joinFocusRoom,leaveFocusRoom,controlFocusRoom,refreshFocusRoom};
}
