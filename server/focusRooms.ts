import {createClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {isSpaceId} from '../shared/space';
import {galleryText} from '../shared/gallery';
import {focusSnapshot} from '../shared/focusRooms';
export class FocusUnavailable extends Error {}
export interface FocusStore {rpc:(name:string,args:Record<string,unknown>)=>Promise<any>}
export function focusStore(env:NodeJS.ProcessEnv):FocusStore{
 const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY||'',{auth:{persistSession:false,autoRefreshToken:false}});
 return {async rpc(name,args){const {data,error}=await db.rpc(name,args);if(error){if(error.code==='P0001')throw new FocusUnavailable('Room unavailable');throw new Error('Focus room storage unavailable');}return data;}};
}
export function createFocusRooms(options:{env?:NodeJS.ProcessEnv;store?:FocusStore}={}){
 const env=options.env||process.env;let storage=options.store;
 const enabled=!!storage||!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim());const db=()=>storage??=focusStore(env);
 const gate:RequestHandler=(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(typeof (req as any).userId!=='string'||(req as any).userId.startsWith('anon:'))return res.status(401).json({error:'Sign in to use Focus Rooms.'});if(!enabled)return res.status(503).json({error:'Focus Rooms need Supabase server setup.'});next();};
 const uuid=(value:unknown)=>{if(!isSpaceId(value))throw new FocusUnavailable('Invalid room or session ID.');return value;};
 const storageFailed=(res:any)=>res.status(503).json({error:'Focus Rooms could not reach storage. Try reconnecting.'});
 const unavailable=(res:any)=>res.status(404).json({error:'Room unavailable or expired. Rooms expire after 24 hours without activity. Open an active invite link to join.'});
 const snapshot=async(owner:string,id:string)=>focusSnapshot(await db().rpc('focus_room_snapshot',{p_user_id:owner,p_id:id}));
 const list:RequestHandler=async(req,res)=>{try{const rows=await db().rpc('list_focus_rooms',{p_user_id:(req as any).userId});res.json({rooms:rows.map((row:any)=>({id:row.id,title:row.title,lastActiveAt:row.last_active_at}))});}catch{res.status(503).json({error:'Could not load Focus Rooms. Apply the latest migration.'});}};
 const create:RequestHandler=async(req,res)=>{let id:string,title:string;try{id=uuid(req.body?.id);title=galleryText(req.body?.title,80,'room title');}catch(error){return res.status(400).json({error:(error as Error).message});}try{res.json({id:await db().rpc('create_focus_room',{p_user_id:(req as any).userId,p_id:id,p_title:title})});}catch(error){if(!(error instanceof FocusUnavailable))return storageFailed(res);res.status(400).json({error:'Room creation was not confirmed. Check your rooms before retrying. Each creator can have up to 10 active rooms.'});}};
 const enter:RequestHandler=async(req,res)=>{let id:string,sessionId:string,name:string,timeZone:string;try{id=uuid(req.params.id);sessionId=uuid(req.body?.sessionId);name=galleryText(req.body?.name,40,'display name');timeZone=req.body?.timeZone;if(typeof timeZone!=='string'||timeZone.length>100)throw new Error('Choose a valid time zone.');new Intl.DateTimeFormat('en',{timeZone});}catch(error){return res.status(400).json({error:(error as Error).message});}try{const owner=(req as any).userId;await db().rpc('enter_focus_room',{p_user_id:owner,p_id:id,p_session_id:sessionId,p_name:name,p_time_zone:timeZone});res.json(await snapshot(owner,id));}catch(error){if(!(error instanceof FocusUnavailable))return storageFailed(res);res.status(404).json({error:'Could not join this room. It may have expired or reached 50 members / 3 tabs per member.'});}};
 const read:RequestHandler=async(req,res)=>{try{res.json(await snapshot((req as any).userId,uuid(req.params.id)));}catch(error){if(error instanceof FocusUnavailable)unavailable(res);else storageFailed(res);}};
 const heartbeat:RequestHandler=async(req,res)=>{try{const id=uuid(req.params.id),owner=(req as any).userId;await db().rpc('heartbeat_focus_room',{p_user_id:owner,p_id:id,p_session_id:uuid(req.body?.sessionId)});res.json(await snapshot(owner,id));}catch(error){if(error instanceof FocusUnavailable)unavailable(res);else storageFailed(res);}};
 const leave:RequestHandler=async(req,res)=>{try{await db().rpc('leave_focus_room',{p_user_id:(req as any).userId,p_id:uuid(req.params.id),p_session_id:uuid(req.body?.sessionId)});res.json({ok:true});}catch{res.status(400).json({error:'Could not confirm leaving. Presence expires automatically if your connection closes.'});}};
 const control:RequestHandler=async(req,res)=>{let id:string;try{id=uuid(req.params.id);if(!['start','pause','reset'].includes(req.body?.action)||!Number.isSafeInteger(req.body?.revision)||req.body.revision<0)throw new Error();}catch{return res.status(400).json({error:'Invalid timer control.'});}try{await db().rpc('control_focus_room',{p_user_id:(req as any).userId,p_id:id,p_revision:req.body.revision,p_action:req.body.action});res.json(await snapshot((req as any).userId,id));}catch(error){if(!(error instanceof FocusUnavailable))return storageFailed(res);res.status(409).json({error:'Timer control was not confirmed. Only the connected host can control it. Refresh before retrying.'});}};
 return {gate,list,create,enter,read,heartbeat,leave,control};
}
