// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import FocusRooms from '../../pages/FocusRooms';
const ctx=vi.hoisted(()=>({user:{id:'owner'},isOffline:false,logOut:vi.fn(async()=>{}),focusRoom:null as any,focusPresence:new Set<string>(),focusRoomStatus:'connected',focusRoomError:'',listFocusRooms:vi.fn(async()=>[]),createFocusRoom:vi.fn(),joinFocusRoom:vi.fn(),leaveFocusRoom:vi.fn(),controlFocusRoom:vi.fn(async()=>{}),refreshFocusRoom:vi.fn(async()=>{})}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
const id='10000000-0000-0000-0000-000000000001';let root:Root,host:HTMLDivElement;
const click=async(text:string)=>act(async()=>Array.from(document.body.querySelectorAll('button')).find(b=>b.textContent===text)!.click());
const render=async(path='/focus-rooms/'+id)=>act(async()=>root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/focus-rooms/:id" element={<FocusRooms/>}/><Route path="/focus-rooms" element={<FocusRooms/>}/></Routes></MemoryRouter>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();ctx.isOffline=false;ctx.focusRoom=null;ctx.focusRoomStatus='connected';host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('shows an explicit join form and shareable invite without exposing account data automatically',async()=>{await render();expect(host.textContent).toContain('your current task-completion streak');expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toContain('/focus-rooms/'+id);expect(ctx.joinFocusRoom).not.toHaveBeenCalled();expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Join room')!.disabled).toBe(true);});
it('disables room operations in local mode while preserving the local focus workflow',async()=>{ctx.isOffline=true;await render('/focus-rooms');expect(host.textContent).toContain('Your local tasks and personal focus timer still work');expect(ctx.listFocusRooms).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Create room');await click('Sign in');expect(ctx.logOut).toHaveBeenCalled();});
it('shows shared time and verified streaks; confirms a reset before sending it to all members',async()=>{
 const stamp=new Date().toISOString();ctx.focusRoom={room:{id,title:'Study room',isHost:true,startedAt:null,elapsedSeconds:0,revision:0,lastActiveAt:stamp},serverNow:stamp,serverTime:Date.now(),receivedAt:performance.now(),members:[{id:'member',name:'Alice',streak:3,sessions:[{id:'session',expiresAt:new Date(Date.now()+120000).toISOString()}]}]};ctx.focusPresence=new Set(['session']);await render();expect(host.querySelector('[role="timer"]')?.textContent).toBe('25:00');expect(host.textContent).toContain('Alice');expect(host.textContent).toContain('3-day streak');await click('Reset timer');expect(ctx.controlFocusRoom).not.toHaveBeenCalled();await click('Reset for everyone');expect(ctx.controlFocusRoom).toHaveBeenCalledWith('reset');
});
it('hides timer controls from non-hosts',async()=>{const stamp=new Date().toISOString();ctx.focusRoom={room:{id,title:'Study room',isHost:false,startedAt:null,elapsedSeconds:0,revision:0,lastActiveAt:stamp},serverNow:stamp,serverTime:Date.now(),receivedAt:performance.now(),members:[]};await render();expect(host.textContent).toContain('room creator controls');expect(host.textContent).not.toContain('Start together');expect(host.textContent).not.toContain('Reset timer');});
