import type {Badge,BadgeKey} from '../../shared/challenges';
import {BADGES} from '../../shared/challenges';
export const LOCAL_BADGES_KEY='zenos.local.build-badges.v1';
export function localBuildBadges(previous:any,day:string,hasPage:boolean,hasRemix:boolean){
 const days=[...new Set<string>([...(Array.isArray(previous?.days)?previous.days.filter((d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)):[]),day])].sort().slice(-7);
 const badges:Badge[]=Array.isArray(previous?.badges)?previous.badges.filter((b:any)=>Object.hasOwn(BADGES,b?.key)&&b.key!=='challenge_winner'&&typeof b.earnedAt==='string'):[];
 const add=(key:BadgeKey)=>{if(!badges.some(b=>b.key===key))badges.push({key,earnedAt:day});};
 if(hasPage)add('first_page');if(hasRemix)add('first_remix');
 if(days.length===7&&days.every((d,i)=>Date.parse(d)-Date.parse(days[0])===i*86400000))add('seven_day_streak');
 return {days,badges};
}
