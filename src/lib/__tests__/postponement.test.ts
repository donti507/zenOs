import { expect, it } from 'vitest';
import type { Task } from '../../types';
import { applyPostponement } from '../postponement';
import { nextOccurrence } from '../recurrence';
const task = (date = '2026-10-27', count = 0): Task => ({ id:'a',title:'Report',cat:'work',status:'todo',date,reminder:'',note:'',progress:0,postponedCount:count });
it.each([
 ['2026-10-27','2026-10-28',1],['2026-12-31','2027-01-01',1],
 ['2026-10-27','2026-10-27',0],['2026-10-27','2026-10-26',0],
 ['','2026-10-28',0],['2026-10-27','',0],['2026-02-31','2026-03-01',0],['2026-10-27','2026-13-01',0],
])('counts date transition %s → %s correctly',(before,after,expected)=>{
 expect(applyPostponement(task(before),{date:after}).postponedCount).toBe(expected);
});
it('retains history on earlier/cleared dates and ignores stale counter values in patches',()=>{
 let current=task('2026-10-27',2);
 current=applyPostponement(current,{date:'2026-10-28',postponedCount:0});expect(current.postponedCount).toBe(3);
 current=applyPostponement(current,{date:'2026-10-28',postponedCount:0});expect(current.postponedCount).toBe(3);
 current=applyPostponement(current,{date:'2026-10-26'});expect(current.postponedCount).toBe(3);
 current=applyPostponement(current,{date:''});expect(current.postponedCount).toBe(3);
 current=applyPostponement(current,{date:'2026-10-30'});expect(current.postponedCount).toBe(3);
 expect(applyPostponement(current,{note:'Edited'}).postponedCount).toBe(3);
});
it('starts legacy tasks at zero and recurring successors at zero',()=>{
 const legacy={...task(),postponedCount:undefined};
 expect(applyPostponement(legacy,{date:'2026-10-28'}).postponedCount).toBe(1);
 expect(nextOccurrence({...task('2026-10-27',5),recurrence:'daily'},'next')?.postponedCount).toBe(0);
});
