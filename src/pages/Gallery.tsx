import LanguageSwitcher from '../components/LanguageSwitcher';
import {tr,useUiLanguage} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
import {gallerySnapshot,type GalleryPage,type GalleryNode} from '../../shared/gallery';
import SpaceFrame from '../components/SpaceFrame';
import {PageHeader,Modal,btn,card,input} from '../components/ui/kit';
export default function Gallery(){
  useUiLanguage();
 const location=useLocation(),navigate=useNavigate();const [query]=useSearchParams();
 const moderation=location.pathname==='/gallery/moderation';
 const selected=moderation?query.get('id'):location.pathname.match(/^\/gallery\/([^/]+)\/?$/)?.[1]||null;
 const {user,isOffline,state,toggleTheme,getGalleryAccount,listGallery,readGalleryPage,getGalleryTree,remixGalleryPage,reportGalleryPage,moderateGalleryPage}=useZenos();
 const [isAdmin,setAdmin]=useState(false),[accountReady,setAccountReady]=useState(false);
 const [pages,setPages]=useState<GalleryPage[]>([]),[page,setPage]=useState<GalleryPage|null>(null),[nodes,setNodes]=useState<GalleryNode[]>([]);
 const [offset,setOffset]=useState(0),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false);
 const [remixOpen,setRemixOpen]=useState(false),[reportOpen,setReportOpen]=useState(false),[deleteId,setDeleteId]=useState<string|null>(null);
 const [title,setTitle]=useState(''),[slug,setSlug]=useState(''),[reason,setReason]=useState('inappropriate');
 const attempt=useRef<{key:string;id:string;versionId:string}|null>(null),operation=useRef(0);
 useEffect(()=>{let active=true;setAdmin(false);setAccountReady(false);void getGalleryAccount().then(data=>{if(active)setAdmin(data.isAdmin===true);}).catch(()=>{}).finally(()=>{if(active)setAccountReady(true);});return ()=>{active=false;};},[user?.id,isOffline,getGalleryAccount]);
 useEffect(()=>{++operation.current;setRemixOpen(false);setReportOpen(false);setDeleteId(null);setBusy(false);setNotice('');setOffset(0);attempt.current=null;},[location.pathname,location.search,user?.id,isOffline]);
 const canRead=!moderation||(accountReady&&isAdmin);
 useEffect(()=>{
  let active=true;const abort=new AbortController();setError('');
  if(!canRead){setLoading(false);setPage(null);setPages([]);return;}
  setLoading(true);setPage(null);setNodes([]);
  void (async()=>{
   if(selected){const data=await readGalleryPage(selected,moderation,abort.signal);if(active)setPage(data);if(!moderation){const tree=await getGalleryTree(selected,abort.signal);if(active)setNodes(tree);}}
   else{const data=await listGallery(offset,moderation,abort.signal);if(active){setPages(previous=>offset?[...previous,...data.pages.filter(row=>!previous.some(old=>old.id===row.id))]:data.pages);setMore(data.hasMore);}}
  })().catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Could not load gallery.');}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;abort.abort();};
 },[selected,moderation,canRead,offset,reload,listGallery,readGalleryPage,getGalleryTree]);
 const refresh=()=>{setOffset(0);setReload(value=>value+1);};
 const perform=async(work:()=>Promise<void>)=>{if(busy)return;const generation=operation.current;setBusy(true);setError('');try{await work();}catch(failure){if(generation===operation.current)setError(failure instanceof Error?failure.message:'Change was not confirmed.');}finally{if(generation===operation.current)setBusy(false);}};
 const remix=()=>perform(async()=>{if(!page)return;const generation=operation.current;const key=JSON.stringify([page.id,slug,title]);if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID(),versionId:crypto.randomUUID()};const saved=await remixGalleryPage(page.id,slug,title,attempt.current.id,attempt.current.versionId);if(generation===operation.current)navigate('/space/'+saved.page.slug);});
 const report=()=>perform(async()=>{if(!page)return;const generation=operation.current;await reportGalleryPage(page.id,reason);if(generation===operation.current){setReportOpen(false);setNotice('Report recorded. Three distinct reports hide a page until moderator review.');refresh();}});
 const moderate=(id:string,action:string)=>perform(async()=>{const generation=operation.current;await moderateGalleryPage(id,action,action==='delete');if(generation===operation.current){setDeleteId(null);setNotice('Moderation action saved.');refresh();}});
 const signed=!!user&&!isOffline;
 return <main className="min-h-dvh bg-surface text-on-surface px-4 py-6 sm:p-8"><div className="max-w-6xl mx-auto space-y-5 min-w-0">
  <div className="flex justify-end"><LanguageSwitcher /></div>
  <nav className="flex flex-wrap items-center gap-2" aria-label={tr("Gallery navigation")}><Link className={btn.secondary} to="/">{tr("Home")}</Link><Link className={btn.secondary} to="/space">{tr("My Space")}</Link><Link className={btn.secondary} to="/gallery">{tr("Gallery")}</Link><Link className={btn.secondary} to="/gallery/challenges">{tr("Challenges")}</Link>{isAdmin&&<Link className={btn.secondary} to="/gallery/moderation">{tr("Moderation")}</Link>}{!user&&<Link className={btn.solid} to="/login">{tr("Sign in")}</Link>}<button className={btn.secondary} onClick={toggleTheme} aria-label={state.theme==='dark'?tr("Switch to light mode"):tr("Switch to dark mode")}>{tr("Theme")}</button></nav>
  <PageHeader title={moderation?tr("Gallery moderation"):tr("My Space gallery")} subtitle={moderation?tr("Review reported pages and manage public snapshots."):tr("Public pages you can explore and remix with credit.")}/>
  <div className="flex flex-wrap gap-2"><button className={btn.secondary} onClick={refresh} disabled={busy}>{tr("Refresh")}</button>{selected&&<Link className={btn.secondary} to={moderation?'/gallery/moderation':'/gallery'}>{tr("All pages")}</Link>}</div>
  {notice&&<p role="status" className="text-sm text-on-surface-variant">{tr(notice)}</p>}{error&&<p role="alert" className="text-sm text-error break-words">{tr(error)}</p>}
  {moderation&&!accountReady?<p role="status">{tr("Checking administrator access…")}</p>:moderation&&!isAdmin?<p className={`${card} p-5`}>{tr("Administrator access required. Sign in with a verified account listed by the server administrator.")}</p>:<>
   {loading&&<p role="status">{tr("Loading pages…")}</p>}
   {page&&<>
    <section className={`${card} p-5 space-y-3 min-w-0`}><h2 className="font-semibold text-xl break-words">{page.title}</h2><p className="text-sm text-on-surface-variant break-words">{tr("By ")}{page.author}</p><p className="whitespace-pre-wrap break-words">{page.description}</p>
     {page.credit&&<p className="text-sm text-on-surface-variant break-words">{tr("Remixed from ")}<Link className="text-primary underline" to={`/gallery/${page.credit.id}`}>{page.credit.title}</Link>{tr(" by ")}{page.credit.author}.{page.credit.original&&<>{tr(" Originally by ")}<Link className="text-primary underline" to={`/gallery/${page.credit.original.id}`}>{page.credit.original.author}</Link>.</>}{tr(" The original may be unavailable.")}</p>}
     {moderation?<div className="flex flex-wrap gap-2"><span className="text-sm">{tr(page.moderation)} · {page.reportCount}{tr(" reports · ")}{page.published?tr("Published"):tr("Withdrawn")}</span>{page.moderation!=='deleted'&&<><button className={btn.secondary} disabled={busy} onClick={()=>void moderate(page.id,'hide')}>{tr("Hide")}</button><button className={btn.secondary} disabled={busy} onClick={()=>void moderate(page.id,'restore')}>{tr("Restore after review")}</button><button className={btn.secondary} disabled={busy} onClick={()=>setDeleteId(page.id)}>{tr("Delete publication")}</button></>}</div>:<div className="flex flex-wrap gap-2">
      {user?<button className={btn.solid} disabled={busy} onClick={()=>{setTitle(page.title);setSlug(('remix-'+crypto.randomUUID().slice(0,8)));setRemixOpen(true);}}>{tr("Remix into My Space")}</button>:<Link className={btn.solid} to="/space">{tr("Sign in or use local mode to remix")}</Link>}
      {signed?<button className={btn.secondary} disabled={busy} onClick={()=>setReportOpen(true)}>{tr("Report")}</button>:<Link className={btn.secondary} to="/login">{tr("Sign in to report")}</Link>}
     </div>}
    </section>
    {page.moderation!=='deleted'&&<SpaceFrame snapshot={gallerySnapshot(page)} publicPreview/>}
    {!moderation&&<section className={`${card} p-5 space-y-3`} aria-label={tr("Remix tree")}><h2 className="font-semibold">{tr("Remix tree")}</h2><p className="text-xs text-on-surface-variant">{tr("Up to 20 ancestors and 50 direct remixes. Open a branch to explore further. Hidden or removed pages are omitted.")}</p><ul className="space-y-3">{nodes.map(node=><li key={node.id} className="border-l-2 border-outline-variant pl-3 break-words" style={{marginLeft:Math.min(6,Math.max(0,node.depth-(nodes[0]?.depth||0)))*8}}><Link className="text-primary underline" to={`/gallery/${node.id}`}>{node.id===page.id?tr("This page: "):node.depth===1?'↳ ':''}{node.title}</Link><span className="text-sm text-on-surface-variant">{tr(" by ")}{node.author}</span></li>)}</ul></section>}
   </>}
   {!selected&&!loading&&!pages.length&&!error&&<p className={`${card} p-5`}>{tr("No published pages yet.")}</p>}
   {!selected&&<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{pages.map(row=><article key={row.id} className={`${card} p-5 min-w-0 space-y-3`}><h2 className="font-semibold break-words"><Link className="text-primary" to={moderation?`/gallery/moderation?id=${row.id}`:`/gallery/${row.id}`}>{row.title}</Link></h2><p className="text-sm text-on-surface-variant break-words">{tr("By ")}{row.author}</p><p className="text-sm break-words line-clamp-3">{row.description}</p>{moderation?<p className="text-xs text-on-surface-variant">{tr(row.moderation)} · {row.reportCount}{tr(" reports · ")}{row.published?tr("Published"):tr("Withdrawn")}</p>:<Link className={btn.secondary} to={`/gallery/${row.id}`}>{tr("View page")}</Link>}{moderation&&<Link className={btn.secondary} to={`/gallery/moderation?id=${row.id}`}>{tr("Review")}</Link>}</article>)}</div>}
   {!selected&&more&&<button className={btn.secondary} disabled={loading} onClick={()=>setOffset(value=>value+24)}>{tr("Load more pages")}</button>}
  </>}
  <Modal open={remixOpen} onClose={()=>!busy&&setRemixOpen(false)} title={tr("Remix into your private space")} footer={<><button className={btn.secondary} disabled={busy} onClick={()=>setRemixOpen(false)}>{tr("Cancel")}</button><button className={btn.solid} disabled={busy||!title.trim()||!slug.trim()} onClick={()=>void remix()}>{tr("Create remix")}</button></>}><p className="text-sm text-on-surface-variant">{tr("Copy this public code with credit to its author. Your copy is private, starts a new save point, and has no task or calendar permissions.")}</p><label className="block text-sm">{tr("Page title")}<input className={`${input} mt-1`} maxLength={80} value={title} onChange={event=>setTitle(event.target.value)}/></label><label className="block text-sm">{tr("Page address")}<input className={`${input} mt-1`} maxLength={48} value={slug} onChange={event=>setSlug(event.target.value)}/></label></Modal>
  <Modal open={reportOpen} onClose={()=>!busy&&setReportOpen(false)} title={tr("Report this page")} footer={<><button className={btn.secondary} disabled={busy} onClick={()=>setReportOpen(false)}>{tr("Cancel")}</button><button className={btn.solid} disabled={busy} onClick={()=>void report()}>{tr("Submit report")}</button></>}><label className="block text-sm">{tr("Reason")}<select className={`${input} mt-1`} value={reason} onChange={event=>setReason(event.target.value)}><option value="inappropriate">{tr("Inappropriate content")}</option><option value="unsafe">{tr("Unsafe behavior")}</option><option value="spam">{tr("Spam")}</option><option value="other">{tr("Other concern")}</option></select></label><p className="text-sm text-on-surface-variant">{tr("Each account counts once per review. Three distinct reports hide the publication until review. Your identity is not public.")}</p></Modal>
  <Modal open={!!deleteId} onClose={()=>!busy&&setDeleteId(null)} title={tr("Delete this publication?")} footer={<><button className={btn.secondary} disabled={busy} onClick={()=>setDeleteId(null)}>{tr("Cancel")}</button><button className={btn.solid} disabled={busy} onClick={()=>deleteId&&void moderate(deleteId,'delete')}>{tr("Permanently delete")}</button></>}><p>{tr("This permanently removes the published code and prevents republishing this entry. The author’s private original and existing remixes are retained. This cannot be restored.")}</p></Modal>
 </div></main>;
}
