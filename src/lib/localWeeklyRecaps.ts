import {buildLocalRecap,calendarDay,recapMonday,shiftRecapDay,weeklyRecap,type WeeklyRecap,type RecapTask} from '../../shared/weeklyRecaps';
export const LOCAL_RECAP_KEY='zenos.local.weekly-recaps.v1';
type Store={recaps:WeeklyRecap[];enabled:boolean;nextSunday:string};
export function latestDueSunday(now:Date,timeZone:string){const today=calendarDay(now,timeZone),day=new Date(today+'T00:00:00Z').getUTCDay();let sunday=shiftRecapDay(today,-day);const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone,hour:'numeric',hourCycle:'h23'}).format(now));if(day===0&&hour<18)sunday=shiftRecapDay(sunday,-7);return sunday;}
export function readLocalRecaps(now:Date,timeZone:string):Store{
 const today=calendarDay(now,timeZone);const nextSunday=shiftRecapDay(recapMonday(today),6);const raw=localStorage.getItem(LOCAL_RECAP_KEY);if(!raw)return{recaps:[],enabled:true,nextSunday};
 const value=JSON.parse(raw);if(!Array.isArray(value.recaps)||typeof value.enabled!=='boolean'||typeof value.nextSunday!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.nextSunday))throw new Error('Local recap storage could not be read. Your saved recaps were not replaced.');
 return {recaps:value.recaps.map(weeklyRecap).sort((a:WeeklyRecap,b:WeeklyRecap)=>b.weekStart.localeCompare(a.weekStart)).slice(0,8),enabled:value.enabled,nextSunday:value.nextSunday};
}
export function saveLocalRecaps(tasks:RecapTask[],now:Date,timeZone:string,mode:'read'|'manual'|'settings',enabled?:boolean){
 const data=readLocalRecaps(now,timeZone);if(enabled!==undefined){if(enabled&&!data.enabled)data.nextSunday=shiftRecapDay(recapMonday(calendarDay(now,timeZone)),6);data.enabled=enabled;}
 const due=latestDueSunday(now,timeZone),automatic=data.enabled&&data.nextSunday<=due;
 const put=(through:string,kind:'manual'|'scheduled')=>{const stats=buildLocalRecap(tasks,now,timeZone,through),previous=data.recaps.find(recap=>recap.weekStart===stats.weekStart);const stamp=now.toISOString();const recap:WeeklyRecap={...stats,id:previous?.id||crypto.randomUUID(),kind,createdAt:previous?.createdAt||stamp,updatedAt:stamp};data.recaps=[recap,...data.recaps.filter(row=>row.weekStart!==recap.weekStart)].sort((a,b)=>b.weekStart.localeCompare(a.weekStart)).slice(0,8);};
 if(automatic)put(due,'scheduled');if(mode==='manual')put(calendarDay(now,timeZone),'manual');
 if(automatic)data.nextSunday=shiftRecapDay(due,7);
 localStorage.setItem(LOCAL_RECAP_KEY,JSON.stringify(data));return data;
}
