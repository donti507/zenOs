import {useState} from 'react';
import {createPortal} from 'react-dom';
import {useZenos} from '../context/ZenosContext';
import {tr,useUiLanguage} from '../i18n';
import {Modal,btn,Icon} from './ui/kit';
export default function UsosAccountControls(){
 useUiLanguage();const {usosEnabled,usosConnected,usosError,connectUsos,disconnectUsos,isOffline}=useZenos();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!usosEnabled||isOffline)return null;
 const run=async(disconnect:boolean)=>{if(busy)return;setBusy(true);setError('');try{if(disconnect){await disconnectUsos();setOpen(false);}else await connectUsos();}catch(e){setError(e instanceof Error?e.message:'USOS sign-in is temporarily unavailable. Please try again.');}finally{setBusy(false);}};
 return <><button role="menuitem" disabled={busy} onClick={()=>usosConnected?setOpen(true):void run(false)} className="w-full px-3 py-2 text-left text-on-surface hover:bg-surface-container disabled:opacity-50 inline-flex items-center gap-2"><Icon name="school"/>{busy?tr('Please wait…'):usosConnected?tr('Disconnect USOS'):tr('Connect USOS')}</button>
 {(error||usosError)&&!open&&<p role="alert" className="text-error text-sm px-3 py-2">{tr(error||usosError)}</p>}
 {createPortal(<Modal open={open} onClose={()=>{if(!busy)setOpen(false);}} title={tr('Disconnect USOS?')} footer={<><button className={btn.secondary} disabled={busy} onClick={()=>setOpen(false)}>{tr('Cancel')}</button><button className={btn.danger} disabled={busy} onClick={()=>void run(true)}>{tr('Disconnect USOS')}</button></>}><p>{tr('This removes university sign-in and the saved USOS credentials. Make sure you have another way to sign in before disconnecting.')}</p>{error&&<p role="alert" className="text-error">{tr(error)}</p>}</Modal>,document.body)}</>;
}
