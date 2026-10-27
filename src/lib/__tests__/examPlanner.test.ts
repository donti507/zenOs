import { describe, expect, it } from 'vitest';
import { planExam, remainingExamTasks, type ExamDraft } from '../examPlanner';
import type { Task } from '../../types';
const draft = (n = 3, overrides: Partial<ExamDraft> = {}): ExamDraft => ({ id:'plan', name:'Physics', examDate:'2026-11-10', minutesPerDay:50, topics:Array.from({length:n},(_,i)=>({id:String(i),title:`Topic ${i}`})), ...overrides });
describe('exam scheduling', () => {
  it('spreads ordered topics before the exam and includes the last available day', () => {
    const sessions = planExam(draft(), '2026-11-01', []);
    expect(sessions.map(s=>s.date)).toEqual(['2026-11-01','2026-11-05','2026-11-09']);
    expect(sessions.map(s=>s.topicId)).toEqual(['0','1','2']);
    expect(sessions.every(s=>s.minutes===25)).toBe(true);
  });
  it('skips days with two meetings, permits one, and plans a single topic backwards', () => {
    expect(planExam(draft(1),'2026-11-01',['2026-11-09','2026-11-09','2026-11-08'])[0].date).toBe('2026-11-08');
    expect(planExam(draft(3),'2026-11-07',['2026-11-08','2026-11-08']).map(s=>s.date)).toEqual(['2026-11-07','2026-11-07','2026-11-09']);
  });
  it('respects daily capacity, including budgets smaller than a session', () => {
    const sessions=planExam(draft(10),'2026-11-05',[]);
    for(const date of new Set(sessions.map(s=>s.date))) expect(sessions.filter(s=>s.date===date).reduce((n,s)=>n+s.minutes,0)).toBeLessThanOrEqual(50);
    expect(planExam(draft(1,{minutesPerDay:10}),'2026-11-09',[])[0].minutes).toBe(10);
    expect(()=>planExam(draft(2,{minutesPerDay:40}),'2026-11-09',[])).toThrow('Not enough');
  });
  it('rejects impossible dates, invalid budgets, empty topics and insufficient free days',()=>{
    for(const d of [draft(0),draft(1,{examDate:'2026-02-30'}),draft(1,{minutesPerDay:0}),draft(1,{minutesPerDay:1.5}),draft(1,{name:' '})]) expect(()=>planExam(d,'2026-11-01',[])).toThrow();
    expect(()=>planExam(draft(1),'2026-11-10',[])).toThrow();
    expect(()=>planExam(draft(1),'2026-11-09',['2026-11-09','2026-11-09'])).toThrow('Not enough');
  });
  it('uses calendar arithmetic through leap days and DST',()=>{
    expect(planExam(draft(3,{examDate:'2028-03-02'}),'2028-02-28',[]).map(s=>s.date)).toEqual(['2028-02-28','2028-02-29','2028-03-01']);
  });
  it('replans only unfinished topics, preserving stable topic identities',()=>{
    const tasks=planExam(draft(),'2026-11-01',[]).map(s=>({id:s.topicId,title:s.topic,date:s.date,status:'todo',examPlan:{...draft(),topicId:s.topicId},steps:[{id:s.topicId,label:s.topic,done:false}]} as unknown as Task));
    tasks[0].status='done';tasks[1].steps![0].done=true;
    const remaining=remainingExamTasks(tasks,'plan');expect(remaining.map(t=>t.id)).toEqual(['2']);
    const result=planExam(draft(1,{topics:remaining.map(t=>({id:t.examPlan!.topicId,title:t.title}))}),'2026-11-08',[]);
    expect(result[0]).toMatchObject({topicId:'2',date:'2026-11-09'});
  });
});
