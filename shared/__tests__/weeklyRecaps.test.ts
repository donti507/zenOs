import {expect,it} from 'vitest';
import {buildLocalRecap,calendarDay,recapMonday,recapSpeech,weeklyRecap} from '../weeklyRecaps';
const now=new Date('2026-10-25T17:00:00Z');
it('counts recorded completions, earliest tied best day, a consecutive streak, and currently slipped tasks without future dates',()=>{
 const tasks=[...['2026-10-19','2026-10-19','2026-10-20','2026-10-20','2026-10-24','2026-10-25'].map((date,i)=>({id:i,title:'Done',date:'',status:'done',completedAt:date+'T12:00:00Z'})),{id:20,title:'Read chapter',status:'todo',date:'2026-10-20'},{id:21,title:'Today is not late',status:'todo',date:'2026-10-25'},{id:22,title:'Old backlog',status:'todo',date:'2026-10-18'},{id:23,title:'Reopened',status:'todo',date:'',completedAt:'2026-10-24T12:00:00Z'},{id:24,title:'Future',status:'done',date:'',completedAt:'2026-10-26T12:00:00Z'}];
 const stats=buildLocalRecap(tasks,now,'UTC');expect(stats).toMatchObject({weekStart:'2026-10-19',throughDate:'2026-10-25',tasksDone:6,bestDay:'2026-10-19',bestDayCount:2,streak:2,slippedCount:1});expect(stats.slippedTasks).toEqual([{id:'20',title:'Read chapter'}]);expect(stats.suggestion).toContain('smaller first step');
});
it('uses the account timezone for week boundaries across Sunday midnight and DST',()=>{
 expect(calendarDay(new Date('2026-10-25T23:30:00Z'),'Europe/Warsaw')).toBe('2026-10-26');expect(recapMonday('2026-10-26')).toBe('2026-10-26');expect(recapMonday('2026-10-25')).toBe('2026-10-19');const tasks=[{id:'a',title:'Late Sunday',status:'done',completedAt:'2026-10-25T23:30:00Z'}];expect(buildLocalRecap(tasks,new Date('2026-10-26T01:00:00Z'),'Europe/Warsaw').tasksDone).toBe(1);expect(buildLocalRecap(tasks,new Date('2026-10-26T01:00:00Z'),'UTC').tasksDone).toBe(0);
});
it('does not invent a best day or count invalid due dates, and produces a short speakable recap',()=>{
 const stats=buildLocalRecap([{id:1,title:'Invalid',status:'todo',date:'2026-02-30'}],new Date('2026-03-01T19:00:00Z'),'UTC');expect(stats).toMatchObject({tasksDone:0,bestDay:null,bestDayCount:0,streak:0,slippedCount:0});const row={...stats,id:'10000000-0000-0000-0000-000000000001',kind:'manual' as const,createdAt:now.toISOString(),updatedAt:now.toISOString()};expect(recapSpeech(row)).toContain('no best day yet');expect(recapSpeech(row)).toContain('One suggestion:');expect(recapSpeech(row).length).toBeLessThan(700);expect(weeklyRecap({...row,user_id:'PRIVATE'})).not.toHaveProperty('user_id');
});
