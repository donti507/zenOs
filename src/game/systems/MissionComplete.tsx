import {motion} from 'motion/react';
import {tr,useUiLanguage} from '../../i18n';
export default function MissionComplete({title,xp,unlocked,reducedMotion,sample=true}:{title:string;xp:number;unlocked:number;reducedMotion:boolean;sample?:boolean}){
 useUiLanguage();return <motion.div role="status" aria-live="polite" initial={reducedMotion?false:{opacity:0,y:8,scale:.96}} animate={{opacity:1,y:0,scale:1}} transition={{duration:reducedMotion?0:.25}} className="rounded-xl bg-success-container text-on-surface p-3 ring-1 ring-success shadow-soft"><p className="font-semibold">{tr('Mission complete')} · {sample?tr('+{{0}} preview XP',xp):tr('+{{0}} XP',xp)}</p><p className="text-sm">{title}</p>{unlocked>0&&<p className="text-sm">{tr('New area unlocked')}</p>}</motion.div>;
}
