import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
import type {SpaceSnapshot} from '../../shared/space';
import type {GalleryPage} from '../../shared/gallery';
import {Modal,btn,input,textarea} from './ui/kit';
export default function PublishSpace({snapshot,onClose}:{snapshot:SpaceSnapshot;onClose:()=>void}){
 const {isOffline,user,ownGalleryPage,publishGalleryPage,withdrawGalleryPage}=useZenos();
 const [title,setTitle]=useState(snapshot.page.title),[description,setDescription]=useState(''),[author,setAuthor]=useState('Creator'),[consent,setConsent]=useState(false);
 const [own,setOwn]=useState<GalleryPage|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setConsent(false);setOwn(null);setError('');setLoading(true);
  if(isOffline){setLoading(false);return;}
  void ownGalleryPage(snapshot.page.id).then(page=>{if(active){setOwn(page);if(page){setTitle(page.title);setDescription(page.description);setAuthor(page.author);}}}).catch(()=>{if(active)setError('Could not read publication status. Try opening this menu again.');}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[snapshot.page.id,snapshot.version.id,user?.id,isOffline,ownGalleryPage]);
 const act=async(withdraw=false)=>{if(busy)return;setBusy(true);setError('');try{if(withdraw&&own)await withdrawGalleryPage(own.id);else await publishGalleryPage(snapshot,{title,description,author,consent});setOwn(await ownGalleryPage(snapshot.page.id));setConsent(false);}catch(failure){setError(failure instanceof Error?failure.message:'Publication was not confirmed.');}finally{setBusy(false);}};
 return <Modal open onClose={()=>!busy&&onClose()} title="Publish to the gallery" footer={<button className={btn.secondary} disabled={busy} onClick={onClose}>Close</button>}>
  {isOffline?<p>Sign in to publish. Your local pages stay private; you can still view the gallery and remix pages locally.</p>:<div className="space-y-4">
   <p className="text-sm text-on-surface-variant">Publish this saved version’s HTML, CSS and JavaScript for anyone to view and remix with credit. Private history, prompts, notes and data permissions are not shared. Later edits stay private until you publish again.</p>
   {loading?<p role="status">Loading publication…</p>:<>
    {own&&<p className="text-sm">Status: {own.moderation}{own.published?' · Published':' · Withdrawn'} · <Link className="text-primary underline" to={`/gallery/${own.id}`}>Public link</Link></p>}
    {own&&own.moderation!=='visible'&&<p className="text-sm text-error">This publication is hidden or deleted. A moderator must review it before it can return.</p>}
    <label className="block text-sm">Public title<input className={`${input} mt-1`} value={title} maxLength={80} onChange={event=>setTitle(event.target.value)}/></label>
    <label className="block text-sm">Description<textarea className={`${textarea} mt-1`} value={description} maxLength={400} onChange={event=>setDescription(event.target.value)}/></label>
    <label className="block text-sm">Public author name<input className={`${input} mt-1`} value={author} maxLength={40} onChange={event=>setAuthor(event.target.value)}/></label>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I want this version to be public and allow others to remix it with credit. Code may contain text I entered; I have reviewed it for private information.</span></label>
    <div className="flex flex-wrap gap-2"><button className={btn.solid} disabled={busy||!consent||!title.trim()||!author.trim()||!!(own&&own.moderation!=='visible')} onClick={()=>void act()}>Publish this version</button>{own?.published&&<button className={btn.secondary} disabled={busy} onClick={()=>void act(true)}>Unpublish</button>}</div>
    <p className="text-xs text-on-surface-variant">Unpublishing removes the public view. It cannot recall copies that others already remixed.</p>
   </>}
  </div>}
  {error&&<p role="alert" className="text-sm text-error break-words">{error}</p>}
 </Modal>;
}
