import {tr,useUiLanguage} from '../i18n';
import type {ReactNode} from 'react';
import {useZenos} from '../context/ZenosContext';
import {btn,card} from './ui/kit';
export default function PersonalSpaceOnly({children}:{children:ReactNode}){
  useUiLanguage();const {activeWorkspaceId,switchWorkspace}=useZenos();return activeWorkspaceId?<div className={card+' p-5 space-y-3'}><h1 className="text-xl font-semibold">{tr("Personal space feature")}</h1><p className="text-on-surface-variant">{tr("Lectures and My Space pages stay private. Switch to Personal space to open them.")}</p><button className={btn.primary} onClick={()=>switchWorkspace(null)}>{tr("Open Personal space")}</button></div>:children;}
