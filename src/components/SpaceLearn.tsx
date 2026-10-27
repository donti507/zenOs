import { useEffect, useMemo, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import type { SpaceVersion } from '../../shared/space';
import { spaceLineDiff } from '../lib/spaceDiff';
import { btn, card } from './ui/kit';

function CodeChanges({before,after,language}:{before:string;after:string;language:string}) {
  const diff=useMemo(()=>spaceLineDiff(before,after),[before,after]);
  const [limit,setLimit]=useState(200);
  useEffect(()=>setLimit(200),[before,after]);
  if(!diff.lines.length) return null;
  return <section className="min-w-0 space-y-2" aria-label={`${language} changes`}>
    <h3 className="font-medium">{language}</h3>
    {diff.coarse && <p className="text-xs text-on-surface-variant">Large edit: the replaced block is highlighted as a whole.</p>}
    <div tabIndex={0} role="region" aria-label={`${language} code comparison`} className="max-h-96 overflow-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
      <pre className="text-xs leading-6 min-w-full w-max"><code>{diff.lines.slice(0,limit).map((line,index)=><span key={index} data-change={line.kind} className={`block px-2 ${line.kind==='added'?'bg-success-container text-on-surface':line.kind==='removed'?'bg-error-container text-on-surface':'text-on-surface-variant'}`}><span className="inline-block w-10 select-none opacity-70" aria-label="Previous line">{line.before ?? ''}</span><span className="inline-block w-10 select-none opacity-70" aria-label="New line">{line.after ?? ''}</span><span className="inline-block w-5 select-none">{line.kind==='added'?'+':line.kind==='removed'?'−':' '}</span>{line.text || ' '}</span>)}</code></pre>
    </div>
    {diff.lines.length>limit && <button className={btn.secondary} onClick={()=>setLimit(value=>value+200)}>Show more {language} lines</button>}
  </section>;
}
export default function SpaceLearn({pageId,versionId}:{pageId:string;versionId:string}) {
  const {readSpaceVersion,user,isOffline}=useZenos();
  const [result,setResult]=useState<{version:SpaceVersion;parent:SpaceVersion|null;key:string}|null>(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const key=`${user?.id}:${isOffline}:${pageId}:${versionId}`;
  useEffect(()=>{
    let active=true;setResult(null);setError('');
    void (async()=>{
      const version=await readSpaceVersion(pageId,versionId);
      const parent=version.parentVersionId?await readSpaceVersion(pageId,version.parentVersionId):null;
      if(active) setResult({version,parent,key});
    })().catch(()=>{if(active) setError('Could not load this explanation and its code changes.');});
    return ()=>{active=false;};
  },[pageId,versionId,user?.id,isOffline,readSpaceVersion,retry]);
  const current=result?.key===key?result:null;
  return <section className={`${card} p-5 space-y-4 min-w-0`} aria-label="Learn about this edit">
    <h2 className="font-semibold">What changed and why</h2>
    {error ? <p role="alert" className="text-error text-sm">{error} <button className={btn.secondary} onClick={()=>setRetry(value=>value+1)}>Retry</button></p> : !current ? <p role="status">Loading explanation…</p> : <>
      {current.version.prompt && <p className="text-xs text-on-surface-variant break-words">Your request: {current.version.prompt}</p>}
      <p className="text-sm whitespace-pre-wrap break-words">{current.version.explanation || (current.version.kind==='initial'?'This is the starting page. Ask the builder for an edit to learn how it changes.':'This older save point has no saved learning explanation.')}</p>
      {current.version.explanation && current.version.kind==='ai' && <p className="text-xs text-on-surface-variant">AI explanation · The line comparison below comes from the saved code.</p>}
      {current.parent ? <>
        <p className="text-xs text-on-surface-variant">− Removed · + Added · Previous / new line numbers. Unchanged sections are omitted.</p>
        {(['html','css','js'] as const).map(language=><div key={language}><CodeChanges language={language.toUpperCase()} before={current.parent![language]} after={current.version[language]}/></div>)}
        {(['html','css','js'] as const).every(language=>current.parent![language]===current.version[language]) && <p className="text-sm text-on-surface-variant">No code lines changed in this save point.</p>}
      </> : current.version.kind!=='initial' && <p className="text-sm text-on-surface-variant">Line comparison is unavailable for this older save point.</p>}
    </>}
  </section>;
}
