import {setUiLanguage,tr,useUiLanguage} from '../i18n';
/** Presentation preference only: never remount the app or write workspace data. */
export default function LanguageSwitcher(){
 const language=useUiLanguage();
 return <div role="group" aria-label={tr('Interface language')} className="inline-flex shrink-0 rounded-lg bg-surface-container p-0.5 border border-outline-variant">
  {(['en','pl'] as const).map(code=><button key={code} type="button" lang={code} aria-label={code==='en'?'English':'Polski'} aria-pressed={language===code} onClick={()=>setUiLanguage(code)} className={`min-w-8 min-h-8 px-1.5 rounded-md text-xs font-semibold focus-visible:outline-2 focus-visible:outline-primary transition-colors ${language===code?'bg-primary-container text-on-primary-container':'text-on-surface-variant hover:bg-surface-container-high'}`}>{code==='en'?'EN':'PL'}</button>)}
 </div>;
}
