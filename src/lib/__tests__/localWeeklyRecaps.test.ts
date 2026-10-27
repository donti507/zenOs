// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {LOCAL_RECAP_KEY,latestDueSunday,saveLocalRecaps,readLocalRecaps} from '../localWeeklyRecaps';
beforeEach(()=>localStorage.clear());
it('generates at Sunday 18:00, once per schedule, catches up when reopened and permits manual refreshes',()=>{
 const morning=new Date('2026-10-25T16:59:00Z');expect(saveLocalRecaps([],morning,'UTC','read').recaps).toHaveLength(0);expect(latestDueSunday(morning,'UTC')).toBe('2026-10-18');const evening=new Date('2026-10-25T18:00:00Z');const data=saveLocalRecaps([],evening,'UTC','read');expect(data.recaps[0]).toMatchObject({weekStart:'2026-10-19',kind:'scheduled'});expect(saveLocalRecaps([],new Date('2026-10-25T20:00:00Z'),'UTC','read').recaps[0].updatedAt).toBe(data.recaps[0].updatedAt);
 const next=saveLocalRecaps([],new Date('2026-11-02T10:00:00Z'),'UTC','manual');expect(next.recaps.map(r=>r.weekStart)).toEqual(['2026-11-02','2026-10-26','2026-10-19']);
});
it('retains eight weeks, deduplicates repeated manual updates and persists automatic opt-out',()=>{
 let data:any;for(let week=0;week<10;week++){const now=new Date(Date.UTC(2026,7,2+7*week,18));data=saveLocalRecaps([],now,'UTC','manual');data=saveLocalRecaps([],now,'UTC','manual');}expect(data.recaps).toHaveLength(8);const newest=data.recaps[0].id;expect(readLocalRecaps(new Date(),'UTC').recaps[0].id).toBe(newest);
 const before=saveLocalRecaps([],new Date('2026-10-25T10:00:00Z'),'UTC','settings',false);const after=saveLocalRecaps([],new Date('2026-10-25T19:00:00Z'),'UTC','read');expect(after.enabled).toBe(false);expect(after.recaps).toEqual(before.recaps);
});
it('preserves unreadable saved data rather than silently overwriting it',()=>{localStorage.setItem(LOCAL_RECAP_KEY,'broken');expect(()=>saveLocalRecaps([],new Date(),'UTC','read')).toThrow();expect(localStorage.getItem(LOCAL_RECAP_KEY)).toBe('broken');});
