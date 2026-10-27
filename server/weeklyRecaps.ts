import {createClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {weeklyRecap} from '../shared/weeklyRecaps';
export interface WeeklyRecapStore {rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;list:(owner:string)=>Promise<any[]>;settings:(owner:string)=>Promise<any|null>}
export function weeklyRecapStore(env:NodeJS.ProcessEnv):WeeklyRecapStore{
 const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const result=async(query:any)=>{const {data,error}=await query;if(error)throw new Error('Recap storage unavailable');return data;};
 return {rpc:(name,args)=>result(db.rpc(name,args)),list:owner=>result(db.from('weekly_recaps').select('id,week_start,through_date,time_zone,tasks_done,best_day,best_day_count,streak,slipped_count,slipped_tasks,suggestion,kind,created_at,updated_at').eq('user_id',owner).order('week_start',{ascending:false}).limit(8)),settings:owner=>result(db.from('weekly_recap_preferences').select('time_zone,enabled,next_due_at').eq('user_id',owner).maybeSingle())};
}
export function createWeeklyRecapWorker(run:()=>Promise<number>,intervalMs=60000){
 let active=false,stopped=false,retryAt=0,failures=0,drain:ReturnType<typeof setTimeout>|undefined;
 const tick=async()=>{if(active||stopped||Date.now()<retryAt)return;active=true;try{const processed=await run();failures=0;retryAt=0;if(processed>=50&&!stopped){drain=setTimeout(()=>void tick(),1000);drain.unref();}}catch{retryAt=Date.now()+Math.min(900000,60000*2**Math.min(failures++,4));}finally{active=false;}};
 const timer=setInterval(()=>void tick(),intervalMs);timer.unref();
 return {tick,close:()=>{stopped=true;clearInterval(timer);if(drain)clearTimeout(drain);}};
}
export function createWeeklyRecaps(options:{env?:NodeJS.ProcessEnv;store?:WeeklyRecapStore}={}){
 const env=options.env||process.env;let storage=options.store;const enabled=!!storage||!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim());const db=()=>storage??=weeklyRecapStore(env);
 const gate:RequestHandler=(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(typeof (req as any).userId!=='string'||(req as any).userId.startsWith('anon:'))return res.status(401).json({error:'Sign in to use cloud recaps.'});if(!enabled)return res.status(503).json({error:'Weekly recaps need Supabase server setup. Local recaps remain available in local mode.'});next();};
 const failed=(res:any)=>res.status(503).json({error:'Could not load or save your weekly recap. Apply the latest migration and try again.'});
 const configure:RequestHandler=async(req,res)=>{const timeZone=req.body?.timeZone;try{if(typeof timeZone!=='string'||timeZone.length>100||('enabled' in (req.body||{})&&typeof req.body.enabled!=='boolean'))throw new Error();new Intl.DateTimeFormat('en',{timeZone});}catch{return res.status(400).json({error:'Choose a valid time zone and automatic recap preference.'});}try{res.json({settings:await db().rpc('configure_weekly_recaps',{p_user_id:(req as any).userId,p_time_zone:timeZone,p_enabled:req.body.enabled??null})});}catch{failed(res);}};
 const list:RequestHandler=async(req,res)=>{try{const owner=(req as any).userId;let pref=await db().settings(owner);if(pref?.enabled){await db().rpc('generate_weekly_recap',{p_user_id:owner,p_automatic:true});pref=await db().settings(owner);}const rows=await db().list(owner);res.json({recaps:rows.map(weeklyRecap),settings:pref?{timeZone:pref.time_zone,enabled:pref.enabled,nextDueAt:pref.next_due_at}:null});}catch{failed(res);}};
 const generate:RequestHandler=async(req,res)=>{try{const row=await db().rpc('generate_weekly_recap',{p_user_id:(req as any).userId,p_automatic:false});res.json({recap:weeklyRecap(row)});}catch{failed(res);}};
 let worker:ReturnType<typeof createWeeklyRecapWorker>|null=null;
 const startWorker=()=>{if(!enabled||env.WEEKLY_RECAP_WORKER==='false'||worker)return;worker=createWeeklyRecapWorker(()=>db().rpc('run_due_weekly_recaps',{p_limit:50}));void worker.tick();};
 return {gate,configure,list,generate,startWorker,close:()=>{worker?.close();worker=null;}};
}
