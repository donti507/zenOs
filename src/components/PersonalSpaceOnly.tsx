import type {ReactNode} from 'react';
import {useZenos} from '../context/ZenosContext';
import {btn,card} from './ui/kit';
export default function PersonalSpaceOnly({children}:{children:ReactNode}){const {activeWorkspaceId,switchWorkspace}=useZenos();return activeWorkspaceId?<div className={card+' p-5 space-y-3'}><h1 className="text-xl font-semibold">Personal space feature</h1><p className="text-on-surface-variant">Lectures and My Space pages stay private. Switch to Personal space to open them.</p><button className={btn.primary} onClick={()=>switchWorkspace(null)}>Open Personal space</button></div>:children;}
