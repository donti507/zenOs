import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
export type SharedWorkspace={id:string;user_id:string;name:string;created_at:string};
export type WorkspaceMember={id:string;workspace_id:string;user_id:string;role:'owner'|'member'};
export function useSharedWorkspaces(ownerId:string|null,isOffline:boolean,onLost:(ids:string[])=>void){
 const [workspaces,setWorkspaces]=useState<SharedWorkspace[]>([]),[workspaceError,setError]=useState<string|null>(null);
 const rowsRef=useRef<SharedWorkspace[]>([]),reads=useRef(0);
 const latest=useRef({ownerId,isOffline,onLost});latest.current={ownerId,isOffline,onLost};
 const current=()=>latest.current.ownerId===ownerId&&latest.current.isOffline===isOffline;
 const refreshWorkspaces=useCallback(async()=>{
  if(!ownerId||isOffline)return [] as SharedWorkspace[];
  const read=++reads.current;
  try{const {data,error}=await supabase.from('workspaces').select('*').order('created_at');if(error)throw error;
   if(!current()||read!==reads.current)return [];const rows=(data||[]) as SharedWorkspace[];rowsRef.current=rows;setWorkspaces(rows);setError(null);latest.current.onLost(rows.map(w=>w.id));return rows;
  }catch{if(current())setError('Could not load shared workspaces. Apply the latest migration and try again.');return [];}
 },[ownerId,isOffline]);
 useEffect(()=>{rowsRef.current=[];++reads.current;setWorkspaces([]);setError(null);if(!ownerId||isOffline)return;void refreshWorkspaces();const tick=()=>{void refreshWorkspaces();};window.addEventListener('focus',tick);const timer=setInterval(tick,20000);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[refreshWorkspaces]);
 const rpc=async(name:string,args:Record<string,unknown>)=>{if(!ownerId||isOffline||!current())throw new Error('Sign in to use shared workspaces.');const {data,error}=await supabase.rpc(name,args);if(!current())throw new Error('Your account changed.');if(error)throw new Error('Workspace request failed. Check your role, invitation and latest migration.');return data;};
 const createWorkspace=async(name:string)=>{const row=await rpc('create_workspace',{p_name:name});await refreshWorkspaces();return row as SharedWorkspace;};
 const inviteWorkspaceMember=async(id:string,email:string)=>{const data=await rpc('invite_workspace_member',{p_workspace:id,p_email:email});return {...data,url:`${window.location.origin}/workspaces#invite=${encodeURIComponent(data.token)}`};};
 const acceptWorkspaceInvite=async(token:string)=>{const id=await rpc('accept_workspace_invite',{p_token:token});await refreshWorkspaces();return id as string;};
 const workspaceInvites=async(id:string)=>{if(!current()||isOffline)throw new Error('Sign in required.');const {data,error}=await supabase.from('workspace_invites').select('id,email,expires_at,revoked,accepted_by').eq('workspace_id',id).eq('revoked',false).is('accepted_at',null).order('created_at',{ascending:false}).limit(100);if(error||!current())throw new Error('Could not load invitations.');return (data||[]) as {id:string;email:string;expires_at:string;revoked:boolean;accepted_by:string|null}[];};
 const workspaceMembers=async(id:string)=>{if(!current()||isOffline)throw new Error('Sign in required.');const {data,error}=await supabase.from('workspace_members').select('*').eq('workspace_id',id);if(error||!current())throw new Error('Could not load members.');return (data||[]) as WorkspaceMember[];};
 const removeWorkspaceMember=async(id:string,user:string)=>{await rpc('remove_workspace_member',{p_workspace:id,p_user:user});await refreshWorkspaces();};
 const revokeWorkspaceInvite=async(id:string)=>{await rpc('revoke_workspace_invite',{p_id:id});};
 return {workspaces,hasWorkspace:(id:string)=>current()&&rowsRef.current.some(row=>row.id===id),workspaceInvites,workspaceError,refreshWorkspaces,createWorkspace,inviteWorkspaceMember,acceptWorkspaceInvite,workspaceMembers,removeWorkspaceMember,revokeWorkspaceInvite};
}
