// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useLectures } from '../useLectures';
import { localLectures } from '../../lib/localLectures';
import type { ZenosState } from '../../types';
import type { Lecture } from '../../../shared/lectures';
vi.mock('../../lib/supabase',()=>({supabase:{from:vi.fn(()=>{throw new Error('Local mode must not contact Supabase');})}}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;let element:HTMLDivElement;let api:ReturnType<typeof useLectures>;let state:ZenosState;
const lecture:Lecture={id:'00000000-0000-0000-0000-000000000123',title:'Energy',durationSeconds:120,transcript:'ATP stores energy.',summary:'Summary',keyPoints:['ATP'],flashcards:Array.from({length:10},()=>({question:'Q',answer:'A',known:null})),actionItems:[{title:'Read chapter',taskId:null}],createdAt:new Date().toISOString()};
function Harness({owner='local'}:{owner?:string}){const [value,setState]=useState({tasks:[],categories:[],lectures:[]} as unknown as ZenosState);const ref=useRef(value);ref.current=value;state=value;api=useLectures({ownerId:owner,isOffline:true,isCurrent:()=>true,stateRef:ref,setState});return null;}
beforeEach(async()=>{localStorage.clear();await new Promise<void>(resolve=>{indexedDB.deleteDatabase('zenos-lectures').onsuccess=()=>resolve();});element=document.createElement('div');document.body.append(element);root=createRoot(element);await act(async()=>{root.render(<Harness/>);});});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.restoreAllMocks();});
it('persists local reviews and creates just one task for repeated action clicks',async()=>{
 await act(async()=>{await api.saveLecture(lecture);});
 await act(async()=>{await api.reviewLectureCard(lecture.id,0,true);await api.reviewLectureCard(lecture.id,1,false);});
 await act(async()=>{await api.addLectureActionTask(lecture.id,0);await api.addLectureActionTask(lecture.id,0);});
 expect(state.tasks).toHaveLength(1);expect(JSON.parse(localStorage.getItem('zenos_tasks')!)).toHaveLength(1);expect(state.tasks[0].title).toBe('Read chapter');
 const saved=(await localLectures())[0];expect(saved.flashcards[0].known).toBe(true);expect(saved.flashcards[1].known).toBe(false);expect(saved.actionItems[0].taskId).toBe(state.tasks[0].id);
 await act(async()=>{await api.saveLecture(lecture);});expect(state.lectures?.[0].flashcards[0].known).toBe(true);
});
it('does not mark an action added when task storage fails and permits a safe retry',async()=>{
 await act(async()=>{await api.saveLecture(lecture);});const original=Storage.prototype.setItem;const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key==='zenos_tasks')throw new Error('Quota exceeded');original.call(this,key,value);});
 await act(async()=>{await expect(api.addLectureActionTask(lecture.id,0)).rejects.toThrow();});expect(state.tasks).toHaveLength(0);expect((await localLectures())[0].actionItems[0].taskId).toBeNull();spy.mockRestore();
 await act(async()=>{await api.addLectureActionTask(lecture.id,0);});expect(state.tasks).toHaveLength(1);
});
it('rejects callbacks retained from a different account',async()=>{
 const old=api;await act(async()=>root.render(<Harness owner="different"/>));await act(async()=>{await expect(old.saveLecture(lecture)).rejects.toThrow('account changed');await localLectures();});expect(await localLectures()).toHaveLength(0);
});
