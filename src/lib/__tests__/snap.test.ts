import { afterEach,expect,it,vi } from 'vitest';
import { createReviewedItems, extractSnap, type SnapRow } from '../snap';
const row=(over:Partial<SnapRow>={}):SnapRow=>({title:'Task',date:'2026-11-02',type:'task',selected:true,...over});
const deps=()=>({addTask:vi.fn(async()=>({id:'task'} as any)),addMeeting:vi.fn(async()=>({id:'meeting'} as any)),category:'other',canContinue:()=>true,onResult:vi.fn()});
afterEach(()=>vi.unstubAllGlobals());
it('creates only selected unsaved rows, with exams as labeled tasks and meetings without invented times',async()=>{
 const d=deps();await createReviewedItems([row(),row({type:'exam',title:'Final'}),row({type:'meeting',title:'Office hours'}),row({selected:false}),row({saved:true})],d);
 expect(d.addTask).toHaveBeenCalledTimes(2);expect(d.addTask).toHaveBeenNthCalledWith(2,expect.objectContaining({title:'Exam: Final',date:'2026-11-02',recurrence:'none'}));
 expect(d.addMeeting).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({subject:'Office hours',time:'',date:'2026-11-02'}));expect(d.onResult).toHaveBeenCalledTimes(3);
});
it('validates edits, preserves partial success on retry, and stops when the user/session leaves',async()=>{
 const d=deps();const rows=[row(),row({type:'meeting'}),row({date:''})];
 d.addTask.mockResolvedValueOnce(null).mockResolvedValue({id:'task'} as any);
 d.onResult.mockImplementation((index,error)=>{rows[index]={...rows[index],saved:!error,error:error||undefined};});
 await createReviewedItems(rows,d);expect(rows[0].saved).toBe(false);expect(rows[1].saved).toBe(true);expect(rows[2].error).toContain('valid date');
 await createReviewedItems(rows,d);expect(d.addMeeting).toHaveBeenCalledOnce();expect(d.addTask).toHaveBeenCalledTimes(2);
 const stopped=deps();stopped.canContinue=()=>false;await createReviewedItems([row()],stopped);expect(stopped.addTask).not.toHaveBeenCalled();
});
it('uploads a raw image with user auth and surfaces rate-limit errors',async()=>{
 const image=new Blob(['image'],{type:'image/png'});const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[]})));vi.stubGlobal('fetch',fetchMock);
 await expect(extractSnap(image,'user-token',new AbortController().signal)).resolves.toEqual([]);
 expect(fetchMock.mock.calls[0][1]).toMatchObject({body:image,headers:{'Content-Type':'image/png',Authorization:'Bearer user-token'}});
 fetchMock.mockResolvedValue(new Response(JSON.stringify({error:'Please wait a minute'}),{status:429}));await expect(extractSnap(image,null,new AbortController().signal)).rejects.toThrow('Please wait a minute');
});
