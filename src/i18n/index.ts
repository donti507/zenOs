import {useSyncExternalStore} from 'react';
import {polish} from './pl';
export type UiLanguage='en'|'pl';
export const UI_LANGUAGE_KEY='zenos_ui_language';
let selected:UiLanguage|undefined;
const listeners=new Set<()=>void>();
export function getUiLanguage():UiLanguage{
 if(selected)return selected;
 try{const saved=localStorage.getItem(UI_LANGUAGE_KEY);if(saved==='pl'||saved==='en')return selected=saved;}catch{}
 const preferred=typeof navigator!=='undefined'?(navigator.languages||[navigator.language]).find(value=>/^(pl|en)(-|$)/i.test(value)):undefined;
 return selected=preferred?.toLowerCase().startsWith('pl')?'pl':'en';
}
function applyDocument(){if(typeof document!=='undefined')document.documentElement.lang=getUiLanguage();}
export function setUiLanguage(language:UiLanguage){
 if(language!=='en'&&language!=='pl')return;
 const changed=getUiLanguage()!==language;selected=language;
 try{localStorage.setItem(UI_LANGUAGE_KEY,language);if(changed)localStorage.setItem('zenos_voice_lang',JSON.stringify(language==='pl'?'pl-PL':'en-US'));}catch{}
 applyDocument();if(changed)for(const notify of listeners)notify();
}
function subscribe(notify:()=>void){listeners.add(notify);return()=>{listeners.delete(notify);};}
export function useUiLanguage(){return useSyncExternalStore(subscribe,getUiLanguage,()=> 'en' as UiLanguage);}
export function uiLocale(){return getUiLanguage()==='pl'?'pl-PL':'en-GB';}
export function speechLocale(){return getUiLanguage()==='pl'?'pl-PL':'en-US';}
/** Only call for application-owned copy, never task titles, notes or generated content. */
export function tr(message:string,...values:unknown[]):string{
 if(!message.trim())return message;
 const key=message.trim();
 let translated=getUiLanguage()==='pl'?(polish[key]??key):key;
 if(getUiLanguage()==='pl'&&!polish[key]){
  const rate=key.match(/^Too many messages\. Wait (\d+)s and try again\.$/);
  const quota=key.match(/^You’ve used your (\d+) Dante (messages|transcriptions) for today\. Take a breather and come back after midnight UTC\.$/);
  const section=key.match(/^Transcribing section (\d+) of (\d+)…$/);
  if(section)translated=`Transkrypcja części ${section[1]} z ${section[2]}…`;
  if(rate)translated=`Zbyt wiele wiadomości. Poczekaj ${rate[1]} s i spróbuj ponownie.`;
  if(quota)translated=`Wykorzystano dzisiejszy limit Dante (${quota[1]} ${quota[2]==='messages'?'wiadomości':'transkrypcji'}). Odpocznij i wróć po północy UTC.`;
 }
 return (message.match(/^\s*/)?.[0]||'')+translated.replace(/\{\{(\d+)\}\}/g,(token,index)=>Number(index)<values.length?String(values[Number(index)]??''):token)+(message.match(/\s*$/)?.[0]||'');
}
if(typeof window!=='undefined'){
 applyDocument();window.addEventListener('storage',event=>{if(event.key!==UI_LANGUAGE_KEY&&event.key!==null)return;selected=undefined;applyDocument();for(const notify of listeners)notify();});
}
const units={
 task:{en:['task','tasks'],pl:['zadanie','zadania','zadań','zadania']},
 day:{en:['day','days'],pl:['dzień','dni','dni','dnia']},
 meeting:{en:['meeting','meetings'],pl:['spotkanie','spotkania','spotkań','spotkania']},
 link:{en:['link','links'],pl:['link','linki','linków','linku']},
 message:{en:['message','messages'],pl:['wiadomość','wiadomości','wiadomości','wiadomości']},
 transcription:{en:['transcription','transcriptions'],pl:['transkrypcja','transkrypcje','transkrypcji','transkrypcji']},
 item:{en:['item','items'],pl:['pozycja','pozycje','pozycji','pozycji']},
} as const;
export function quantity(count:number,unit:keyof typeof units){const language=getUiLanguage(),category=new Intl.PluralRules(language).select(count);const words=units[unit][language];const word=language==='en'?words[category==='one'?0:1]:words[category==='one'?0:category==='few'?1:category==='many'?2:3];return `${new Intl.NumberFormat(uiLocale()).format(count)} ${word}`;}
