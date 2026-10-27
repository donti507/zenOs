import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import type { SpacePage, SpaceSnapshot, SpaceWidgetAction } from '../../shared/space';
import SpaceFrame from './SpaceFrame';
import { btn, card } from './ui/kit';

function Widget({page,index,total}:{page:SpacePage;index:number;total:number}) {
  const {loadSpacePage,changeSpaceWidget,user,isOffline} = useZenos();
  const [snapshot,setSnapshot] = useState<SpaceSnapshot|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active=true;
    setSnapshot(null); setError('');
    void loadSpacePage(page.slug).then(data => {if(active) setSnapshot(data);}).catch(() => {if(active) setError('Could not load this widget.');});
    return () => {active=false;};
  },[page.id,page.slug,page.currentVersionId,user?.id,isOffline,loadSpacePage,retry]);
  const change = async(action:SpaceWidgetAction) => {
    if(busy) return;
    setBusy(true);setError('');
    try {await changeSpaceWidget(page.id,action);} catch(failure) {setError(failure instanceof Error ? failure.message : 'Could not save widget.');} finally {setBusy(false);}
  };
  return <article className={`${card} min-w-0 p-4 space-y-3 `} aria-label={`${page.title} widget`}>
    <Link className="font-semibold text-primary break-words" to={`/space/${page.slug}`}>{page.title}</Link>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">Size <select className="rounded-lg bg-surface-container-low text-on-surface p-2" value={page.dashboardSize || 'small'} disabled={busy} onChange={event => void change(event.target.value as 'small'|'medium')}><option value="small">Small</option><option value="medium">Medium</option></select></label>
      <button className={btn.secondary} aria-label={`Move ${page.title} earlier`} disabled={busy||index===0} onClick={() => void change('earlier')}>Earlier</button>
      <button className={btn.secondary} aria-label={`Move ${page.title} later`} disabled={busy||index===total-1} onClick={() => void change('later')}>Later</button>
      <button className={btn.secondary} disabled={busy} onClick={() => void change('unpin')}>Unpin</button>
    </div>
    {error && <div role="alert" className="text-error text-sm">{error} <button className={btn.secondary} onClick={() => setRetry(value=>value+1)}>Retry</button></div>}
    {snapshot && snapshot.version.id === page.currentVersionId ? <SpaceFrame snapshot={{...snapshot,page}} widgetSize={page.dashboardSize || 'small'} /> : !error && <p role="status">Loading widget…</p>}
  </article>;
}
export default function SpaceWidgets() {
  const {spacePages,user,isOffline,spacePagesError} = useZenos();
  const pages=(spacePages || []).filter(page=>page.dashboardSize).sort((a,b)=>(a.dashboardOrder??0)-(b.dashboardOrder??0)||a.id.localeCompare(b.id));
  if(!pages.length) return spacePagesError ? <p role="alert" className="text-error text-sm">{spacePagesError}</p> : null;
  return <section aria-label="My Space widgets" className="space-y-3 min-w-0">
    <h2 className="font-semibold text-on-surface">My Space</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">{pages.map((page,index)=><div key={`${user?.id}:${isOffline}:${page.id}:${index}`} className={`min-w-0 ${page.dashboardSize==='medium'?'md:col-span-2':''}`}><Widget page={page} index={index} total={pages.length}/></div>)}</div>
  </section>;
}
