import {tr,useUiLanguage,uiLocale,quantity} from '../i18n';
import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
import {localizedRecapDay as recapDayLabel,localizedRecapSpeech as recapSpeech} from '../i18n/recaps';
import {useDantePlayback} from '../hooks/useDantePlayback';
import {btn,card,input,Icon} from './ui/kit';
export default function WeeklyRecap(){
  const uiLanguage=useUiLanguage();
 const {user,isOffline,liveOpen,weeklyRecaps,recapSettings,recapLoading,recapGenerating,recapError,refreshWeeklyRecaps,generateWeeklyRecap,setWeeklyRecapAutomatic}=useZenos();
 const [selectedId,setSelected]=useState('');const selected=weeklyRecaps.find(recap=>recap.id===selectedId)||weeklyRecaps[0]||null;
 const playback=useDantePlayback(`${uiLanguage}:${user?.id}:${isOffline}:${selected?.id}:${selected?.updatedAt}`);
 useEffect(()=>{const abort=new AbortController();void refreshWeeklyRecaps(abort.signal).catch(()=>{});const check=()=>{if(document.visibilityState==='visible')void refreshWeeklyRecaps().catch(()=>{});};const timer=setInterval(check,60000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{abort.abort();clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[refreshWeeklyRecaps]);
 useEffect(()=>{if(liveOpen)playback.stop();},[liveOpen,playback.stop]);
 const generate=async()=>{try{playback.stop();await generateWeeklyRecap();setSelected('');}catch{/* Context owns the visible error. */}};
 const date=(day:string)=>new Date(day+'T12:00:00').toLocaleDateString(uiLocale(),{day:'numeric',month:'short'});
 return <section className={`${card} p-5 md:p-6 space-y-4 min-w-0`} aria-label={tr("Weekly recap")}>
  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3"><div><h2 className="font-semibold text-lg text-on-surface">{tr("Your weekly recap")}</h2><p className="text-sm text-on-surface-variant">{tr("A small look back, with one idea for what comes next.")}</p></div><button className={`${btn.secondary} self-start shrink-0`} disabled={recapGenerating||recapLoading} onClick={()=>void generate()}><Icon name="refresh"/>{recapGenerating?tr("Making your recap…"):selected?tr("Update recap"):tr("Generate recap")}</button></div>
  <label className="flex items-start gap-2 text-sm text-on-surface-variant"><input type="checkbox" className="mt-1 accent-primary" checked={recapSettings?.enabled??true} disabled={!recapSettings||recapGenerating} onChange={event=>void setWeeklyRecapAutomatic(event.target.checked).catch(()=>{})}/><span>{tr("Automatic on Sundays at 6 p.m.")}{recapSettings&&<> · {recapSettings.timeZone}</>}{isOffline&&<span className="block text-xs mt-1">{tr("Local recaps catch up when this browser is opened.")}</span>}</span></label>
  {recapLoading&&!selected&&<p role="status" className="text-sm text-on-surface-variant">{tr("Loading your recaps…")}</p>}
  {!selected&&!recapLoading&&!recapError&&<p className="text-sm text-on-surface-variant">{tr("Your first recap will appear on Sunday. You can make one now, too.")}</p>}
  {selected&&<>
   <div className="flex flex-col sm:flex-row sm:items-center gap-3"><label className="text-sm flex-1 min-w-0">{tr("Saved recaps")}<select className={`${input} mt-1 w-full min-w-0`} value={selected.id} onChange={event=>setSelected(event.target.value)}>{weeklyRecaps.map(recap=><option key={recap.id} value={recap.id}>{date(recap.weekStart)} – {date(recap.throughDate)} · {new Date(recap.updatedAt).getFullYear()}</option>)}</select></label><p className="text-xs text-on-surface-variant sm:max-w-48">{tr("Updated ")}{new Date(selected.updatedAt).toLocaleString(uiLocale())}{tr(" · latest 8 weeks saved · ")}{selected.timeZone}</p></div>
   <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[{label:'Tasks done',value:String(selected.tasksDone),detail:'Recorded completions this week'},{label:'Best day',value:selected.bestDay?recapDayLabel(selected.bestDay):'Not yet',detail:selected.bestDay?tr('Completed: {{0}}',quantity(selected.bestDayCount,'task')):'No completions recorded'},{label:'Completion streak',value:quantity(selected.streak,'day'),detail:'As of this recap'},{label:'What slipped',value:String(selected.slippedCount),detail:'Open tasks overdue this week'}].map(item=><div key={tr(item.label)} className="rounded-xl bg-surface-container-low p-3 min-w-0"><dt className="text-xs text-on-surface-variant">{tr(item.label)}</dt><dd className="text-xl font-semibold text-on-surface break-words mt-1">{tr(item.value)}</dd><p className="text-xs text-on-surface-variant mt-1">{tr(item.detail)}</p></div>)}</dl>
   {!!selected.slippedTasks.length&&<div className="text-sm"><p className="font-medium text-on-surface">{tr("Still waiting for a next step")}</p><ul className="mt-1 list-disc pl-5 space-y-1 text-on-surface-variant">{selected.slippedTasks.map(task=><li key={task.id} className="break-words">{task.title}</li>)}</ul>{selected.slippedCount>selected.slippedTasks.length&&<p className="text-xs text-on-surface-variant mt-1">{tr("And ")}{selected.slippedCount-selected.slippedTasks.length}{tr(" more.")}</p>}</div>}
   <p className="text-sm text-on-surface"><span className="font-semibold">{tr("One suggestion: ")}</span>{tr(selected.suggestion)}</p>
   <div className="flex flex-wrap items-center gap-2"><button className={btn.solid} disabled={!playback.supported||!!liveOpen} onClick={()=>playback.speaking?playback.stop():playback.play(recapSpeech(selected))}><Icon name={playback.speaking?'stop':'volume_up'}/>{playback.speaking?tr("Stop recap"):tr("Play recap")}</button><span className="text-xs text-on-surface-variant">{playback.supported?tr("Dante Live voice"):tr("Voice playback is unavailable in this browser.")}</span><Link className={btn.ghost} to="/tasks">{tr("Open tasks")}</Link></div>
  </>}
  {(recapError||playback.error)&&<p role="alert" className="text-sm text-error break-words">{tr(recapError||playback.error)}</p>}
 </section>;
}
