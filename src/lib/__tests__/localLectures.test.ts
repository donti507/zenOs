import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { changeLocalLecture, localLectures } from '../localLectures';
import type { Lecture } from '../../../shared/lectures';
const lecture:Lecture={id:'id',title:'Energy',durationSeconds:100,transcript:'ATP stores energy.',summary:'Summary',keyPoints:['ATP'],flashcards:Array.from({length:10},()=>({question:'Q',answer:'A',known:null})),actionItems:[{title:'Read',taskId:null}],createdAt:new Date().toISOString()};
beforeEach(()=>new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('zenos-lectures');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);}));
it('persists full study guides and serializes concurrent reviews without overwriting progress',async()=>{
 await changeLocalLecture(lecture.id,()=>lecture);
 await Promise.all([0,1].map(index=>changeLocalLecture(lecture.id,old=>({...old!,flashcards:old!.flashcards.map((card,i)=>i===index?{...card,known:index===0}:card)}))));
 const stored=(await localLectures())[0];expect(stored.transcript).toBe(lecture.transcript);expect(stored.flashcards[0].known).toBe(true);expect(stored.flashcards[1].known).toBe(false);
 await changeLocalLecture(lecture.id,existing=>existing||lecture);expect((await localLectures())[0]).toEqual(stored);
});
it('aborts malformed changes without damaging saved notes',async()=>{
 await changeLocalLecture(lecture.id,()=>lecture);await expect(changeLocalLecture(lecture.id,old=>({...old!,flashcards:[]}))).rejects.toThrow('Could not save');expect((await localLectures())[0]).toEqual(lecture);
});
