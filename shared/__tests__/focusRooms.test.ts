import {expect,it,vi} from 'vitest';
import {focusClock,focusOnlineMembers,focusPresenceIds,focusSnapshot,focusTopic,type FocusSample} from '../focusRooms';
const id='10000000-0000-0000-0000-000000000001',member='20000000-0000-0000-0000-000000000001',session='30000000-0000-0000-0000-000000000001';
const now=Date.parse('2026-10-27T12:00:00Z');const sample:FocusSample={room:{id,title:'Room',isHost:true,startedAt:new Date(now).toISOString(),elapsedSeconds:0,revision:1,lastActiveAt:new Date(now).toISOString()},members:[{id:member,name:'Alice',streak:3,sessions:[{id:session,expiresAt:new Date(now+120000).toISOString()}]}],serverNow:new Date(now).toISOString(),serverTime:now,receivedAt:100};
it('derives continuous 25/5 cycles identically for late joiners and handles exact phase boundaries',()=>{
 expect(focusClock(sample,100)).toMatchObject({phase:'focus',remaining:1500,round:1});expect(focusClock(sample,100+1500000)).toMatchObject({phase:'break',remaining:300,round:1});expect(focusClock(sample,100+1800000)).toMatchObject({phase:'focus',remaining:1500,round:2});expect(focusClock({...sample,receivedAt:999,serverTime:now+1810000},999)).toMatchObject({phase:'focus',remaining:1490,round:2});
});
it('preserves paused time and ignores laptop wall-clock changes',()=>{
 vi.spyOn(Date,'now').mockReturnValue(now+99*86400000);expect(focusClock(sample,1100).remaining).toBe(1499);expect(focusClock({...sample,room:{...sample.room,startedAt:null,elapsedSeconds:1502}},9999999)).toMatchObject({phase:'break',remaining:298,running:false});vi.restoreAllMocks();
});
it('uses only live session identifiers from presence, keeps canonical names/streaks and deduplicates tabs',()=>{
 const ids=focusPresenceIds({one:[{sessionId:session,name:'Forged',streak:999},{sessionId:session}],two:[{sessionId:member},{sessionId:'bad'}]});const members=focusOnlineMembers(sample,ids,100);expect(members).toHaveLength(1);expect(members[0]).toMatchObject({name:'Alice',streak:3});expect(focusOnlineMembers(sample,ids,120101)).toHaveLength(0);expect(focusOnlineMembers(sample,new Set(),100)).toHaveLength(0);
});
it('rejects invalid room payloads and does not carry extra server/private fields into client state',()=>{
 expect(()=>focusTopic('bad')).toThrow();expect(()=>focusSnapshot({...sample,room:{...sample.room,elapsedSeconds:NaN}})).toThrow();expect(focusSnapshot({...sample,token:'secret',room:{...sample.room,user_id:'private'}})).not.toHaveProperty('token');expect(focusSnapshot(sample).room).not.toHaveProperty('user_id');
});
