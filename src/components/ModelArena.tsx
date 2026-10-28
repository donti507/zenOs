import {tr,useUiLanguage} from '../i18n';
import {useEffect,useState} from 'react';
import {useZenos} from '../context/ZenosContext';
import {arenaModel} from '../../shared/arena';
import {btn,card,input,textarea} from './ui/kit';
import DanteUsageNotice from './DanteUsageNotice';
type Status={ready:boolean;cloudReady:boolean;authRequired?:boolean;models:string[];problem:string|null};
export default function ModelArena(){
  useUiLanguage();
 const {user,isOffline,arenaRound,arenaRunning,arenaVoting,arenaError,arenaBoardError,arenaLeaderboard,compareArena,cancelArena,voteArena,refreshArenaLeaderboard}=useZenos();
 const [status,setStatus]=useState<Status|null>(null),[prompt,setPrompt]=useState(''),[models,setModels]=useState<[string,string]>(['','']),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;const abort=new AbortController();setStatus(null);setPrompt('');setError('');
  void fetch('/api/space/arena/status',{signal:abort.signal}).then(async response=>{if(!response.ok)throw new Error();return response.json();}).then(data=>{
   if(!active)return;const allowed=Array.isArray(data.models)?data.models.map(arenaModel):[];setStatus({...data,models:allowed});setModels([allowed[0]||'',allowed[1]||'']);void refreshArenaLeaderboard();
  }).catch(()=>{if(active)setError('Could not load Arena settings.');});
  return ()=>{active=false;abort.abort();cancelArena();};
 },[user?.id,isOffline,cancelArena,refreshArenaLeaderboard]);
 const blocked=!!(status?.authRequired&&isOffline)||!status?.ready||(!isOffline&&!status.cloudReady)||models[0]===models[1]||!models.every(Boolean);
 const run=async()=>{setError('');try{await compareArena(prompt,models);}catch(failure){setError(failure instanceof Error?failure.message:'Could not start comparison.');}};
 return <div className="space-y-5 min-w-0">
  <section className={`${card} p-5 space-y-4`} aria-label={tr("Model Arena prompt")}>
   <h2 className="font-semibold text-on-surface">{tr("One prompt, two models")}</h2>
   <p className="text-sm text-on-surface-variant">{tr("Compare two answers as they arrive, then vote for your favorite. Each comparison uses 2 Dante messages. Only your votes appear on your leaderboard.")}</p>
   <form className="space-y-4" onSubmit={event=>{event.preventDefault();void run();}}>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{([0,1] as const).map(index=><label key={index} className="block text-sm min-w-0">{tr("Model ")}{index===0?tr("A"):tr("B")}<select className={`${input} mt-1 w-full min-w-0`} value={models[index]} disabled={arenaRunning} onChange={event=>setModels(previous=>index===0?[event.target.value,previous[1]]:[previous[0],event.target.value])}>{status?.models.map(model=><option key={model} value={model}>{model}</option>)}</select></label>)}</div>
    <label className="block text-sm">{tr("Your prompt")}<textarea className={`${textarea} mt-1 w-full`} maxLength={2000} value={prompt} disabled={arenaRunning} onChange={event=>setPrompt(event.target.value)} placeholder={tr("Explain a concept, compare ideas, or ask for a small code example…")}/></label>
    <div className="flex flex-wrap gap-2"><button className={btn.solid} disabled={arenaRunning||arenaVoting||blocked||!prompt.trim()}>{arenaRunning?tr("Comparing…"):tr("Compare models")}</button>{arenaRunning&&<button type="button" className={btn.secondary} onClick={cancelArena}>{tr("Stop comparison")}</button>}</div>
   </form>
   {(status?.authRequired&&isOffline)&&<p className="text-sm text-on-surface-variant">{tr("Sign in to compare models on this server.")}</p>}
   {(!status?.ready||(!isOffline&&!status.cloudReady))&&<p className="text-sm text-on-surface-variant">{status?.problem||(!isOffline&&status&&!status.cloudReady?tr("Arena cloud storage needs server setup."):tr("Loading model settings…"))}</p>}
   {models[0]&&models[0]===models[1]&&<p className="text-sm text-error">{tr("Choose two different models.")}</p>}
   {(error||arenaError)&&<p role="alert" className="text-sm text-error break-words">{tr(error||arenaError)}</p>}
  </section>
  {arenaRound&&<section aria-label={tr("Model answers")} className="space-y-3 min-w-0">
   <p className="text-sm text-on-surface-variant">{arenaRound.winner?tr("Your vote is saved."):arenaRound.eligible?tr("Both answers are complete. Which is better?"):tr("Voting opens after both answers finish and the comparison is saved.")}</p>
   <div className="grid grid-cols-2 gap-2 sm:gap-4 min-w-0">{([0,1] as const).map(index=><article key={index} className={`${card} p-3 sm:p-5 min-w-0 space-y-3`} aria-label={tr("Model {{0}} answer",index===0?'A':'B')}>
    <h3 className="font-semibold break-all text-sm">{arenaRound.models[index]}</h3>
    <p role="status" className="text-xs text-on-surface-variant">{arenaRound.states[index]==='error'?tr("This model could not finish."):arenaRound.states[index]==='done'?tr("Finished"):arenaRound.states[index]==='stopped'?tr("Stopped"):arenaRound.states[index]==='streaming'?tr("Answering…"):tr("Waiting…")}</p>
    <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm max-h-[60dvh] overflow-y-auto min-w-0" aria-label={tr("Answer {{0}} text",index===0?'A':'B')}>{arenaRound.answers[index]||'…'}</pre>
    <button className={`${btn.secondary} w-full text-xs sm:text-sm whitespace-normal`} disabled={arenaRunning||arenaVoting||!arenaRound.eligible||!!arenaRound.winner} onClick={()=>void voteArena(index===0?'a':'b').catch(()=>{})}>{arenaRound.winner===(index===0?'a':'b')?tr("Voted for this answer"):tr("Vote for {{0}}",index===0?'A':'B')}</button>
   </article>)}</div>
  </section>}
  <section className={`${card} p-5 space-y-3 min-w-0`} aria-label={tr("Your model leaderboard")}>
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{tr("Your leaderboard")}</h2><button className={btn.secondary} onClick={()=>void refreshArenaLeaderboard()}>{tr("Refresh votes")}</button></div>
   <p className="text-xs text-on-surface-variant">{tr("Wins from your votes only. Comparisons without a vote are excluded.")}</p>
   {arenaBoardError&&<p role="alert" className="text-sm text-error">{tr(arenaBoardError)}</p>}
   {arenaLeaderboard.length?<table className="w-full table-fixed text-sm"><thead><tr className="text-left text-on-surface-variant"><th className="w-1/2 py-2">{tr("Model")}</th><th>{tr("Wins")}</th><th>{tr("Voted rounds")}</th></tr></thead><tbody>{arenaLeaderboard.map(row=><tr key={row.model} className="border-t border-outline-variant"><th scope="row" className="text-left font-medium py-2 break-all pr-2">{row.model}</th><td>{row.wins}</td><td>{row.comparisons}</td></tr>)}</tbody></table>:<p className="text-sm text-on-surface-variant">{tr("Vote on a completed comparison to start your leaderboard.")}</p>}
  </section>
  {!isOffline&&<DanteUsageNotice/>}
 </div>;
}
