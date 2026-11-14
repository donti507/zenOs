import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
import {tr,useUiLanguage} from '../i18n';
import {PageHeader,btn,card} from '../components/ui/kit';
import type {AdventureSpec} from '../game/spec';
import AdventureViewport from '../game/AdventureViewport';
export default function AdventurePlay(){
 useUiLanguage();const {id}=useParams();const {loadAdventure}=useZenos();const [result,setResult]=useState<{id:string;spec?:AdventureSpec;error?:boolean}|null>(null);
 useEffect(()=>{let current=true;void loadAdventure(id||'').then(spec=>{if(current)setResult({id:id!,spec});}).catch(()=>{if(current)setResult({id:id!,error:true});});return()=>{current=false;};},[id,loadAdventure]);
 if(result?.id!==id)return <p role="status" className="text-on-surface-variant">{tr('Loading adventure…')}</p>;
 if(result.error||!result.spec)return <section className={card+' p-5 space-y-4'}><h1 className="text-xl font-semibold">{tr('Adventure unavailable')}</h1><p role="alert">{tr('This adventure could not be opened. Choose a supported adventure from the list.')}</p><Link to="/adventures" className={btn.primary}>{tr('Back to Adventures')}</Link></section>;
 return <section><PageHeader title={result.spec.title} subtitle={tr('Exploration preview · Quests and scoring are not active yet.')} actions={<Link className={btn.secondary} to="/adventures">{tr('Back to Adventures')}</Link>}/><div key={id}><AdventureViewport spec={result.spec}/></div><details className={card+' mt-6 p-4'}><summary className="cursor-pointer font-medium min-h-8">{tr('About this sample')}</summary><p className="mt-3 text-on-surface-variant">{tr('Walk around the village and meet its characters. This preview does not generate content, check answers or award XP.')}</p><h2 className="font-medium mt-4 mb-2">{tr('Learning objectives')}</h2><ul className="list-disc pl-5 space-y-1">{result.spec.objectives.map(objective=><li key={objective.id}>{objective.text}</li>)}</ul><p className="mt-4 text-xs text-on-surface-variant">{tr('World art: Kenney — Isometric Buildings (CC0). Explorer art: ZEN OS.')}</p></details></section>;
}
