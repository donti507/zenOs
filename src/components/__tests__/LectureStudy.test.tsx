// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import LectureStudy from '../LectureStudy';
const review=vi.fn(async()=>{}),add=vi.fn(async()=>{});
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>({reviewLectureCard:review,addLectureActionTask:add})}));
it('flips cards, records known/unknown judgments and adds actions only on a click',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const container=document.createElement('div');const root=createRoot(container);
 const lecture={id:'id',title:'Energy',durationSeconds:100,transcript:'Transcript',summary:'Summary',keyPoints:['ATP'],flashcards:Array.from({length:10},(_,i)=>({question:`Question ${i}`,answer:`Answer ${i}`,known:null})),actionItems:[{title:'Read chapter',taskId:null}],createdAt:new Date().toISOString()};
 const click=async(text:string)=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());};
 try{await act(async()=>root.render(<LectureStudy lecture={lecture}/>));expect(add).not.toHaveBeenCalled();expect(container.textContent).toContain('Question 0');await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Flip flashcard 1"]')!.click());expect(container.textContent).toContain('Answer 0');
 await click('Known');expect(review).toHaveBeenLastCalledWith('id',0,true);await click('Unknown');expect(review).toHaveBeenLastCalledWith('id',1,false);await click('Add as task');expect(add).toHaveBeenCalledWith('id',0);
 await act(async()=>root.render(<LectureStudy lecture={lecture} unsaved/>));expect([...container.querySelectorAll('button')].find(b=>b.textContent==='Add as task')!.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());}
});
