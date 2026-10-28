import {useNavigate} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
export default function WorkspaceSwitcher({compact=false}:{compact?:boolean}){
 const {workspaces,activeWorkspaceId,switchWorkspace,isOffline}=useZenos();const navigate=useNavigate();
 if(isOffline)return null;
 return <div className={`flex min-w-0 gap-1 ${compact?'max-w-36':'px-3 mb-3'}`}>
  <select aria-label="Current workspace" value={activeWorkspaceId||''} onChange={e=>switchWorkspace(e.target.value||null)} className="min-w-0 flex-1 rounded-lg bg-surface-container text-on-surface p-2 text-sm border border-outline-variant">
   <option value="">Personal space</option>{(workspaces||[]).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
  </select><button type="button" aria-label="Manage workspaces" title="Manage workspaces" onClick={()=>navigate('/workspaces')} className="shrink-0 rounded-lg p-1 text-on-surface-variant hover:bg-surface-container"><span className="material-symbols-outlined text-lg">group_add</span></button>
 </div>;
}
