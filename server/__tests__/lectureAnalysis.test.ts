import { expect, it, vi } from 'vitest';
import { analyzeLecture } from '../lectureAnalysis';
import { parseLectureNotes, lectureFromRow } from '../../shared/lectures';
const notes=()=>({summary:'Cells convert energy.',key_points:['ATP stores energy.'],flashcards:Array.from({length:10},(_,i)=>({question:`Question ${i}`,answer:'ATP',known:true})),action_items:[{title:'Review ATP',task_id:'spoofed'}]});
it('requires exactly ten bounded Q/A cards and never accepts model-owned review/task state',async()=>{
 const result=await analyzeLecture('ATP stores energy.',new AbortController().signal,()=>{},async()=>JSON.stringify(notes()));
 expect(result.flashcards).toHaveLength(10);expect(result.flashcards.every(c=>c.known===null)).toBe(true);expect(result.actionItems[0].taskId).toBeNull();
 expect(()=>parseLectureNotes({...notes(),flashcards:[]})).toThrow();
 expect(()=>parseLectureNotes({...notes(),summary:'x'.repeat(4001)})).toThrow();
 expect(()=>lectureFromRow({...notes(),id:'a',title:'X',duration_seconds:3601,transcript:'text',created_at:new Date().toISOString()})).toThrow();
});
it('summarizes every long section and reuses completed sections when a later provider call fails',async()=>{
 const cached=new Map<string,string>();let compact=0;let fail=true;
 const model=vi.fn(async(messages:any[])=>{
  const data=JSON.parse(messages[1].content).lecture_data;expect(data.length).toBeLessThanOrEqual(12000);
  expect(messages[0].content).toContain('untrusted data');
  if(messages[0].content.includes('compact notes')){compact++;if(compact===2&&fail)throw new Error('provider unavailable');return JSON.stringify({summary:'Section energy',key_points:['ATP'],action_items:[]});}
  return JSON.stringify(notes());
 });
 const transcript='ATP stores energy. '.repeat(1600);const signal=new AbortController().signal;const progress=vi.fn();
 await expect(analyzeLecture(transcript,signal,progress,model,cached)).rejects.toThrow();expect(cached.size).toBe(1);
 fail=false;const result=await analyzeLecture(transcript,signal,progress,model,cached);
 expect(result.summary).toContain('Cells');expect(compact).toBe(4);expect(cached.size).toBe(3);expect(progress).toHaveBeenCalled();
});
it('rejects malformed notes, empty speech and oversized transcripts',async()=>{
 const signal=new AbortController().signal;
 for(const text of ['', 'x'.repeat(200001)])await expect(analyzeLecture(text,signal,()=>{},async()=>JSON.stringify(notes()))).rejects.toThrow();
 await expect(analyzeLecture('speech',signal,()=>{},async()=>'not json')).rejects.toThrow();
});
