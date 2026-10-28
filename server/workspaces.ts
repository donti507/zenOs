import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {DanteContext} from './prompt';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Canonical shared context, read under the verified bearer token and membership RLS. */
export function createWorkspaceContextReader(options:{env?:NodeJS.ProcessEnv;client?:(token:string)=>SupabaseClient}={}){
 const env=options.env||process.env;
 return async(owner:string,authorization:string|undefined,context:DanteContext):Promise<DanteContext|null>=>{
  if(context?.workspaceId==null)return null;
  if(typeof context.workspaceId!=='string'||!uuid.test(context.workspaceId)||!owner||owner.startsWith('anon:'))throw new Error('Invalid workspace');
  const token=authorization?.startsWith('Bearer ')?authorization.slice(7):'';if(!token)throw new Error('Sign in required');
  const client=options.client?options.client(token):createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL||'',env.SUPABASE_ANON_KEY||env.VITE_SUPABASE_ANON_KEY||'',{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const scope=context.workspaceId;
  const membership=await client.from('workspace_members').select('role').eq('workspace_id',scope).eq('user_id',owner).maybeSingle();
  if(membership.error||!membership.data)throw new Error('Workspace membership required');
  const results=await Promise.all(['tasks','categories','meetings','vault_items'].map(table=>client.from(table).select('*').eq('workspace_id',scope).order('id').limit(table==='tasks'?150:50)));
  if(results.some(result=>result.error))throw new Error('Workspace unavailable');
  // Never carry client data/memory/retrieval/Google events from personal or another workspace.
  const [tasks,categories,meetings,vault]=results.map(r=>(r.data||[]).filter(row=>row.workspace_id===scope));
  return {workspaceId:scope,mode:context.mode==='voice'?'voice':'chat',userName:context.userName,language:context.language,now:context.now,
   tasks:tasks.map(t=>({id:t.id,title:t.title,status:t.status,date:t.date,cat:t.cat,progress:t.progress,note:t.note,repeat:t.recurrence,reminder:t.reminder})),
   categories:categories.map(c=>({id:c.id,label:c.label})),meetings:meetings.map(m=>({id:m.id,personName:m.person_name,date:m.date,time:m.time,subject:m.subject,status:m.status,notes:m.notes})),
   vault:vault.map(v=>({name:v.name,url:v.url,detail:v.detail})),memory:[],googleEvents:[],stats:{}};
 };
}
