import {expect,it} from 'vitest';
import {localBuildBadges} from '../buildBadges';
it('tracks distinct consecutive local dates, keeps earned milestones and ignores cloud winner claims',()=>{
 let data:any=null;
 for(let i=1;i<=7;i++){data=localBuildBadges(data,`2026-10-${String(i).padStart(2,'0')}`,i===1,i===2);data=localBuildBadges(data,`2026-10-${String(i).padStart(2,'0')}`,false,false);}
 expect(data.badges.map((b:any)=>b.key)).toEqual(['first_page','first_remix','seven_day_streak']);expect(data.days).toHaveLength(7);
 data=localBuildBadges({...data,badges:[...data.badges,{key:'challenge_winner',earnedAt:'2026-10-01'}]},'2026-10-10',false,false);expect(data.badges).toHaveLength(3);
});
it('does not award a streak for duplicates or a missing day, including across a month boundary',()=>{
 let data:any=null;for(const day of ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-04','2026-10-04'])data=localBuildBadges(data,day,false,false);expect(data.badges).toEqual([]);
 data=null;for(const day of ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'])data=localBuildBadges(data,day,false,false);expect(data.badges.map((b:any)=>b.key)).toEqual(['seven_day_streak']);
});
