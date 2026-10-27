import {createClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {challengeInput,BADGES} from '../shared/challenges';
import {isSpaceId} from '../shared/space';
export interface ChallengeStore {
 rpc:(name:string,args?:Record<string,unknown>)=>Promise<any>;
 list:(offset:number)=>Promise<any[]>;
 create:(owner:string,input:ReturnType<typeof challengeInput>,id:string)=>Promise<string>;
 mine:(owner:string)=>Promise<any[]>;
}
export function challengeStore(env:NodeJS.ProcessEnv):ChallengeStore{
 const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const result=async(q:any)=>{const {data,error}=await q;if(error)throw new Error('Challenge storage unavailable');return data;};
 return {
  rpc:(name,args={})=>result(db.rpc(name,args)),
  list:offset=>result(db.from('space_challenges').select('id,title,description,starts_at,ends_at,finalized').order('starts_at',{ascending:false}).order('id').range(offset,offset+24)),
  async create(owner,input,id){const existing=await result(db.from('space_challenges').select('id,user_id,title,description,starts_at,ends_at').eq('id',id).maybeSingle());if(existing){if(existing.user_id!==owner||existing.title!==input.title||existing.description!==input.description||Date.parse(existing.starts_at)!==Date.parse(input.startsAt)||Date.parse(existing.ends_at)!==Date.parse(input.endsAt))throw new Error('Request changed');return existing.id;}await result(db.from('space_challenges').insert({id,user_id:owner,title:input.title,description:input.description,starts_at:input.startsAt,ends_at:input.endsAt}));return id;},
  mine:owner=>result(db.from('space_gallery_pages').select('id,title').eq('user_id',owner).eq('published',true).eq('moderation','visible').order('created_at',{ascending:false}).limit(200)),
 };
}
export function createChallenges(options:{env?:NodeJS.ProcessEnv;store?:ChallengeStore}={}){
 const env=options.env||process.env;let storage=options.store;const db=()=>storage??=challengeStore(env);
 const id=(value:unknown)=>{if(!isSpaceId(value))throw new Error('Invalid ID');return value;};
 const failed=(res:any)=>res.status(400).json({error:'Change not confirmed. Challenges accept one published page and one permanent vote per account while open. You cannot vote for your own entry.'});
 const readFailed=(res:any)=>res.status(503).json({error:'Could not load challenges. Apply the latest migration.'});
 const list:RequestHandler=async(req,res)=>{const offset=Number(req.query.offset??0);if(!Number.isInteger(offset)||offset<0||offset>10000)return res.status(400).json({error:'Invalid page.'});try{await db().rpc('finalize_space_challenges');const rows=await db().list(offset);res.json({challenges:rows.slice(0,24).map(row=>({id:row.id,title:row.title,description:row.description,startsAt:row.starts_at,endsAt:row.ends_at,finalized:row.finalized})),hasMore:rows.length>24});}catch{readFailed(res);}};
 const detail=(privateRead=false):RequestHandler=>async(req,res)=>{try{const challengeId=id(req.params.id);await db().rpc('finalize_space_challenges');const data=await db().rpc('space_challenge_detail',{p_id:challengeId,p_user_id:privateRead?(req as any).userId:null});if(!data)return res.status(404).json({error:'Challenge not found.'});res.json(data);}catch{readFailed(res);}};
 const create:RequestHandler=async(req,res)=>{let input:ReturnType<typeof challengeInput>;try{input=challengeInput(req.body);id(req.body?.id);if(Date.parse(input.endsAt)<=Date.now())throw new Error('End date must be in the future.');}catch(error){return res.status(400).json({error:(error as Error).message});}try{res.json({id:await db().create((req as any).userId,input,req.body.id)});}catch{failed(res);}};
 const submit:RequestHandler=async(req,res)=>{try{const entryId=await db().rpc('submit_space_challenge',{p_user_id:(req as any).userId,p_challenge_id:id(req.params.id),p_gallery_id:id(req.body?.pageId)});res.json({id:entryId});}catch{failed(res);}};
 const vote:RequestHandler=async(req,res)=>{try{if(req.body?.confirm!==true)return res.status(400).json({error:'Confirm your permanent vote.'});await db().rpc('vote_space_challenge',{p_user_id:(req as any).userId,p_challenge_id:id(req.params.id),p_entry_id:id(req.body?.entryId)});res.json({ok:true});}catch{failed(res);}};
 const mine:RequestHandler=async(req,res)=>{try{res.json({pages:(await db().mine((req as any).userId)).map(row=>({id:row.id,title:row.title}))});}catch{readFailed(res);}};
 const badges:RequestHandler=async(req,res)=>{try{await db().rpc('finalize_space_challenges');const rows=await db().rpc('refresh_space_badges',{p_user_id:(req as any).userId});res.json({badges:rows.filter((row:any)=>Object.hasOwn(BADGES,row.badge)).map((row:any)=>({key:row.badge,earnedAt:row.created_at}))});}catch{readFailed(res);}};
 return {list,detail:detail(),myDetail:detail(true),create,submit,vote,mine,badges};
}
