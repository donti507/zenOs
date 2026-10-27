// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useFocusRooms} from '../useFocusRooms';
const transport=vi.hoisted(()=>({setAuth:vi.fn(async()=>{}),channel:vi.fn(),remove:vi.fn(async()=>{})}));
vi.mock('../../lib/supabase',()=>({supabase:{realtime:{setAuth:transport.setAuth},channel:transport.channel,removeChannel:transport.remove}}));
const id='10000000-0000-0000-0000-000000000001',member='20000000-0000-0000-0000-000000000001';let root:Root,api:ReturnType<typeof useFocusRooms>,channel:any,handlers:Record<string,()=>void>,sessionId:string,revision:number,current=true;
const token=vi.fn(async()=> 'owner-token');const now=()=>new Date().toISOString();
const state=()=>({room:{id,title:'Room',isHost:true,startedAt:null,elapsedSeconds:0,revision,lastActiveAt:now()},members:[{id:member,name:'Alice',streak:2,sessions:[{id:sessionId,expiresAt:new Date(Date.now()+120000).toISOString()}]}],serverNow:now()});
function Harness({owner='owner',offline=false}:{owner?:string|null;offline?:boolean}){api=useFocusRooms({ownerId:owner,isOffline:offline,getToken:token,isCurrent:()=>current});return null;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();current=true;revision=0;sessionId='30000000-0000-0000-0000-000000000001';handlers={};channel={state:'joined',on:vi.fn((type:string,_filter:any,callback:()=>void)=>{handlers[type]=callback;return channel;}),subscribe:vi.fn((callback:any)=>{queueMicrotask(()=>callback('SUBSCRIBED'));return channel;}),track:vi.fn(async()=> 'ok'),presenceState:vi.fn(()=>({one:[{sessionId,name:'Forged',streak:999}]}))};transport.channel.mockReturnValue(channel);vi.stubGlobal('fetch',vi.fn(async(url:any,options:any)=>{if(String(url).endsWith('/leave'))return Response.json({ok:true});if(String(url).endsWith('/join'))sessionId=JSON.parse(options.body).sessionId;if(String(url).endsWith('/control'))revision++;return Response.json(state());}));root=createRoot(document.createElement('div'));});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
const join=async()=>{await act(async()=>root.render(<Harness/>));await act(async()=>api.joinFocusRoom(id,'Alice'));await vi.waitFor(()=>expect(api.focusRoomStatus).toBe('connected'));};
it('creates a private presence channel only after verified join and never puts names, streaks or auth tokens into tracked presence',async()=>{
 await join();expect(transport.channel).toHaveBeenCalledWith('zenos:focus:'+id,{config:{private:true,presence:{key:sessionId}}});expect(channel.track).toHaveBeenCalledWith({sessionId});const options=vi.mocked(fetch).mock.calls.find(([url])=>String(url).endsWith('/join'))![1]!;expect(options.headers).toMatchObject({Authorization:'Bearer owner-token'});expect(JSON.parse(String(options.body))).not.toHaveProperty('user_id');
 await act(async()=>handlers.presence());expect(api.focusPresence.has(sessionId)).toBe(true);expect(api.focusRoom?.members[0]).toMatchObject({name:'Alice',streak:2});
});
it('uses server revisions for controls and reads canonical state after broadcasts',async()=>{
 await join();await act(async()=>api.controlFocusRoom('start'));const options=vi.mocked(fetch).mock.calls.find(([url])=>String(url).endsWith('/control'))![1]!;expect(JSON.parse(String(options.body))).toEqual({action:'start',revision:0});expect(api.focusRoom?.room.revision).toBe(1);
 revision=2;await act(async()=>handlers.broadcast());await vi.waitFor(()=>expect(api.focusRoom?.room.revision).toBe(2));
});
it('removes channels and membership on leave/account change and blocks all local-mode room activity',async()=>{
 await join();await act(async()=>api.leaveFocusRoom());expect(transport.remove).toHaveBeenCalledWith(channel);expect(api.focusRoom).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([url,options])=>String(url).endsWith('/leave')&&(options?.headers as any).Authorization==='Bearer owner-token')).toBe(true);
 vi.mocked(fetch).mockClear();transport.channel.mockClear();await act(async()=>root.render(<Harness offline/>));expect(()=>api.joinFocusRoom(id,'Alice')).toThrow('Sign in');await expect(api.listFocusRooms()).rejects.toThrow('Sign in');expect(fetch).not.toHaveBeenCalled();expect(transport.channel).not.toHaveBeenCalled();
});
it('ignores a late join response after leaving and does not subscribe the old room',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(<Harness/>));await act(async()=>api.joinFocusRoom(id,'Alice'));await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>api.leaveFocusRoom());await act(async()=>finish(Response.json(state())));expect(api.focusRoom).toBeNull();expect(transport.channel).not.toHaveBeenCalled();
});
it('drops an expired room and prevents delayed presence events from restoring stale members',async()=>{
 await join();vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'Room expired'},{status:404}));await act(async()=>api.refreshFocusRoom());expect(api.focusRoomStatus).toBe('error');expect(transport.remove).toHaveBeenCalledWith(channel);await act(async()=>handlers.presence());expect(api.focusPresence.size).toBe(0);
});

it('waits for the previous topic to unsubscribe before subscribing a replacement session',async()=>{
 await join();let finish:any;transport.remove.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>api.joinFocusRoom(id,'Alice again'));await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(transport.channel).toHaveBeenCalledTimes(1);await act(async()=>finish());await vi.waitFor(()=>expect(transport.channel).toHaveBeenCalledTimes(2));
});

it('does not report live connectivity when Presence tracking fails even if API polling succeeds',async()=>{
 channel.track.mockResolvedValue('timed out');await act(async()=>root.render(<Harness/>));await act(async()=>api.joinFocusRoom(id,'Alice'));await vi.waitFor(()=>expect(api.focusRoomStatus).toBe('reconnecting'));await act(async()=>api.refreshFocusRoom());expect(api.focusRoomStatus).toBe('reconnecting');
});

it('restores the observed member set after a temporary API outage without requiring another presence event',async()=>{
 await join();vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'Storage unavailable'},{status:503}));await act(async()=>api.refreshFocusRoom());expect(api.focusPresence.size).toBe(0);expect(api.focusRoomStatus).toBe('reconnecting');await act(async()=>api.refreshFocusRoom());expect(api.focusRoomStatus).toBe('connected');expect(api.focusPresence.has(sessionId)).toBe(true);
});
