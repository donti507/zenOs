import {createClient} from '@supabase/supabase-js';
import type {RequestHandler} from 'express';
import {galleryMetadata,galleryPage} from '../shared/gallery';
import {isSpaceId,spaceSlug,spaceText} from '../shared/space';
const META='id,title,description,author,parent_id,remix_credit,created_at,updated_at';
export interface GalleryStore {
 list:(offset:number,admin:boolean)=>Promise<any[]>;
 detail:(id:string,admin:boolean)=>Promise<any|null>;
 mine:(owner:string,pageId:string)=>Promise<any|null>;
 tree:(id:string)=>Promise<any[]>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;
 identity:(owner:string)=>Promise<{email?:string;email_confirmed_at?:string}|null>;
}
export function galleryStore(env:NodeJS.ProcessEnv):GalleryStore{
 const client=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_SERVICE_ROLE_KEY||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const result=async(query:any)=>{const {data,error}=await query;if(error)throw new Error('Gallery storage unavailable');return data;};
 return {
  async list(offset,admin){let query=client.from('space_gallery_pages').select(META+(admin?',published,moderation,report_count':''));if(!admin)query=query.eq('published',true).eq('moderation','visible');return result(query.order('created_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+24));},
  async detail(id,admin){let query=client.from('space_gallery_pages').select(META+',html,css,js'+(admin?',published,moderation,report_count':'' )).eq('id',id);if(!admin)query=query.eq('published',true).eq('moderation','visible');return result(query.maybeSingle());},
  async mine(owner,pageId){return result(client.from('space_gallery_pages').select(META+',published,moderation,report_count').eq('user_id',owner).eq('source_page_id',pageId).maybeSingle());},
  async tree(id){return result(client.rpc('space_gallery_tree',{p_id:id}));},
  async rpc(name,args){return result(client.rpc(name,args));},
  async identity(owner){const {data,error}=await client.auth.admin.getUserById(owner);if(error)throw new Error('Identity unavailable');return data.user;},
 };
}
export function createGallery(options:{env?:NodeJS.ProcessEnv;store?:GalleryStore}={}){
 const env=options.env||process.env;const enabled=!!options.store||!!((env.SUPABASE_URL||env.VITE_SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim());let store=options.store;
 const db=()=>store??=galleryStore(env);
 const admins=new Set((env.ADMIN_EMAILS||'').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean));
 const noCache:RequestHandler=(_req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!enabled)return res.status(503).json({error:'Public gallery needs server setup.'});next();};
 const signed:RequestHandler=(req,res,next)=>{if(typeof (req as any).userId!=='string'||(req as any).userId.startsWith('anon:'))return res.status(401).json({error:'Sign in to publish, report or moderate pages.'});next();};
 const isAdmin=async(owner:string)=>{if(!admins.size)return false;const identity=await db().identity(owner);return !!identity?.email_confirmed_at&&typeof identity.email==='string'&&admins.has(identity.email.trim().toLowerCase());};
 const admin:RequestHandler=async(req,res,next)=>{try{if(!await isAdmin((req as any).userId))return res.status(403).json({error:'Administrator access required.'});next();}catch{res.status(503).json({error:'Could not verify administrator access.'});}};
 const status:RequestHandler=(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({enabled});};
 const account:RequestHandler=async(req,res)=>{try{res.json({isAdmin:await isAdmin((req as any).userId)});}catch{res.status(503).json({error:'Could not verify administrator access.'});}};
 const id=(value:unknown)=>{if(!isSpaceId(value))throw new Error('Invalid page ID.');return value;};
 const fail=(res:any)=>res.status(400).json({error:'This change was not confirmed. Refresh the page; hidden or deleted publications require moderator review.'});
 const list=(administrative=false):RequestHandler=>async(req,res)=>{
  const offset=Number(req.query.offset??0);if(!Number.isInteger(offset)||offset<0||offset>10000)return res.status(400).json({error:'Invalid gallery page.'});
  try{const rows=await db().list(offset,administrative);res.json({pages:rows.slice(0,24).map(row=>galleryPage(row)),hasMore:rows.length>24});}catch{res.status(503).json({error:'Could not load the gallery. Apply the latest migration.'});}
 };
 const detail=(administrative=false):RequestHandler=>async(req,res)=>{try{const row=await db().detail(id(req.params.id),administrative);if(!row)return res.status(404).json({error:'Public page unavailable.'});res.json({page:galleryPage(row,true)});}catch{res.status(404).json({error:'Public page unavailable.'});}};
 const tree:RequestHandler=async(req,res)=>{try{const pageId=id(req.params.id);if(!await db().detail(pageId,false))return res.status(404).json({error:'Public page unavailable.'});const rows=await db().tree(pageId);res.json({nodes:rows.map(row=>({id:id(row.id),parentId:row.parent_id??null,title:spaceText(row.title,80,'title'),author:spaceText(row.author,40,'author'),depth:Number(row.depth)}))});}catch{res.status(404).json({error:'Remix tree unavailable.'});}};
 const mine:RequestHandler=async(req,res)=>{try{const row=await db().mine((req as any).userId,id(req.params.id));res.json({page:row?galleryPage(row):null});}catch{res.status(503).json({error:'Could not load publication status.'});}};
 const publish:RequestHandler=async(req,res)=>{
  let input:ReturnType<typeof galleryMetadata>,pageId:string,versionId:string;
  try{input=galleryMetadata(req.body);pageId=id(req.body?.pageId);versionId=id(req.body?.versionId);if(req.body?.consent!==true)throw new Error('Confirm that this version can be public and remixed.');}catch(error){return res.status(400).json({error:(error as Error).message});}
  try{const publishedId=await db().rpc('publish_space_gallery',{p_user_id:(req as any).userId,p_page_id:pageId,p_version_id:versionId,p_title:input.title,p_description:input.description,p_author:input.author});res.json({id:publishedId});}catch{fail(res);}
 };
 const withdraw:RequestHandler=async(req,res)=>{try{await db().rpc('withdraw_space_gallery',{p_user_id:(req as any).userId,p_id:id(req.params.id)});res.json({ok:true});}catch{fail(res);}};
 const report:RequestHandler=async(req,res)=>{try{if(!['inappropriate','unsafe','spam','other'].includes(req.body?.reason))return res.status(400).json({error:'Choose a report reason.'});await db().rpc('report_space_gallery',{p_user_id:(req as any).userId,p_id:id(req.params.id),p_reason:req.body.reason});res.json({ok:true});}catch{fail(res);}};
 const remix:RequestHandler=async(req,res)=>{try{const snapshot=await db().rpc('remix_space_gallery',{p_user_id:(req as any).userId,p_id:id(req.params.id),p_new_id:id(req.body?.id),p_slug:spaceSlug(req.body?.slug),p_title:spaceText(req.body?.title,80,'page title'),p_version_id:id(req.body?.versionId)});res.json({snapshot});}catch{res.status(400).json({error:'Remix was not confirmed. Check your pages and choose an unused page address before retrying.'});}};
 const moderate:RequestHandler=async(req,res)=>{try{if(!['hide','restore','delete'].includes(req.body?.action))return res.status(400).json({error:'Invalid moderation action.'});if(req.body.action==='delete'&&req.body.confirm!==true)return res.status(400).json({error:'Confirm permanent deletion.'});await db().rpc('moderate_space_gallery',{p_id:id(req.params.id),p_action:req.body.action});res.json({ok:true});}catch{fail(res);}};
 return {status,noCache,signed,admin,account,list:list(),adminList:list(true),detail:detail(),adminDetail:detail(true),tree,mine,publish,withdraw,report,remix,moderate};
}
