import {createPortal} from 'react-dom';
import {useEffect,useState} from 'react';
import type {AdventureSpec} from '../spec';
import type {QuestProgress} from './quest';
import {missionForNpc,questStatus} from './quest';
import {npcDialogue,dialogueIndex} from './dialogue';
import {Modal,btn} from '../../components/ui/kit';
import {tr,useUiLanguage} from '../../i18n';
export default function DialogueBox({spec,npcId,progress,reducedMotion,onClose,onQuest}:{spec:AdventureSpec;npcId:string;progress:QuestProgress;reducedMotion:boolean;onClose:()=>void;onQuest:(type:'accept'|'complete',id:string)=>void}){
 useUiLanguage();const lines=npcDialogue(spec,npcId),npc=spec.npcs.find(n=>n.id===npcId)!;
 const [index,setIndex]=useState(0),[count,setCount]=useState(0);const line=lines[index],characters=Array.from(line?.text||''),revealed=reducedMotion||count>=characters.length,last=index===lines.length-1;
 useEffect(()=>{setCount(0);if(reducedMotion)return;const timer=window.setInterval(()=>setCount(value=>{const next=Math.min(value+2,characters.length);if(next>=characters.length)window.clearInterval(timer);return next;}),30);return()=>window.clearInterval(timer);},[index,reducedMotion,line?.text]);
 const advance=()=>{if(!revealed){setCount(characters.length);return;}if(!last)setIndex(i=>dialogueIndex(i,lines.length,1));};
 const mission=missionForNpc(spec,progress,npcId),status=mission?questStatus(spec,progress,mission.id):'completed';
 const objective=spec.objectives.find(o=>o.id===mission?.objectiveId);
 if(!npc||!line)return null;
 const finish = mission && (status==='available'||status==='active') ? <button className={btn.primary} onClick={()=>onQuest(status==='available'?'accept':'complete',mission.id)}>{status==='available'?tr('Accept mission'):tr('Complete preview step')}</button> : null;
 const controls = !revealed||!last ? <button className={btn.primary} onClick={advance}>{revealed?tr('Next'):tr('Show full line')}</button> : <><button className={btn.secondary} onClick={onClose}>{tr('Leave conversation')}</button>{finish}</>;
 return createPortal(<div onKeyDown={event=>{if(event.code==='KeyE'&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();if(!event.repeat)advance();}}}>
  <Modal open onClose={onClose} title={npc.name} footer={<div className="flex flex-wrap gap-2 justify-end"><button className={btn.secondary} disabled={index===0} onClick={()=>setIndex(i=>dialogueIndex(i,lines.length,-1))}>{tr('Previous')}</button>{controls}</div>}>
   <p className="text-sm font-medium text-primary">{line?.speakerName??tr('You')} · {tr('Line {{0}} of {{1}}',index+1,lines.length)}</p>
   <p className="min-h-20 text-on-surface leading-relaxed"><span aria-hidden="true">{characters.slice(0,reducedMotion?characters.length:count).join('')}</span><span className="sr-only" aria-live="polite">{line?.text}</span></p>
   {last&&revealed&&mission&&<section className="rounded-lg bg-surface-container-low p-3 space-y-2"><h3 className="font-semibold">{mission.title}</h3><p className="text-sm text-on-surface-variant">{objective?.text}</p>{status==='locked'?<p className="text-sm">{tr('Finish the prerequisite missions first.')}</p>:<p className="text-sm text-on-surface-variant">{tr('Preview step: read the briefing, then complete it to test progression. Puzzle answers are not checked yet.')}</p>}</section>}
   {last&&revealed&&!mission&&<p className="text-sm text-on-surface-variant">{tr('All missions from this character are complete.')}</p>}
  </Modal>
 </div>,document.body);
}
