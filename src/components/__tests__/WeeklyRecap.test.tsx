// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import WeeklyRecap from '../WeeklyRecap';
const fixture=vi.hoisted(()=>({ctx:{} as any,play:vi.fn(),stop:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>fixture.ctx}));
vi.mock('../../hooks/useDantePlayback',()=>({useDantePlayback:()=>({supported:true,speaking:false,error:'',play:fixture.play,stop:fixture.stop})}));
let root:Root,host:HTMLDivElement;const row={id:'10000000-0000-0000-0000-000000000001',weekStart:'2026-10-19',throughDate:'2026-10-25',timeZone:'UTC',tasksDone:5,bestDay:'2026-10-20',bestDayCount:3,streak:2,slippedCount:1,slippedTasks:[{id:'task',title:'Read chapter'}],suggestion:'Choose one slipped task and give it a smaller first step.',kind:'scheduled',createdAt:'2026-10-25T18:00:00Z',updatedAt:'2026-10-25T18:00:00Z'};
const click=async(text:string)=>act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent?.trim()===text)!.click());
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();fixture.ctx={user:{id:'owner'},isOffline:false,liveOpen:false,weeklyRecaps:[row],recapSettings:{timeZone:'UTC',enabled:true,nextDueAt:'2026-11-01T18:00:00Z'},recapLoading:false,recapGenerating:false,recapError:'',refreshWeeklyRecaps:vi.fn(async()=>{}),generateWeeklyRecap:vi.fn(async()=>{}),setWeeklyRecapAutomatic:vi.fn(async()=>{})};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async()=>act(async()=>root.render(<MemoryRouter><WeeklyRecap/></MemoryRouter>));
it('shows all five recap parts, keeps the history selector, and only speaks after clicking Play recap',async()=>{await render();expect(host.textContent).toContain('Tuesday');expect(host.textContent).toContain('2 days');expect(host.textContent).toContain('Read chapter');expect(host.textContent).toContain('One suggestion:');expect(host.querySelectorAll('select option')).toHaveLength(1);expect(fixture.play).not.toHaveBeenCalled();await click('volume_upPlay recap');expect(fixture.play).toHaveBeenCalledWith(expect.stringContaining('You completed 5 tasks.'));});
it('generates on demand and persists an automatic Sunday opt-out',async()=>{await render();await click('refreshUpdate recap');expect(fixture.ctx.generateWeeklyRecap).toHaveBeenCalledOnce();await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(fixture.ctx.setWeeklyRecapAutomatic).toHaveBeenCalledWith(false);});
it('shows an honest empty state rather than invented statistics and identifies local catch-up behavior',async()=>{fixture.ctx.weeklyRecaps=[];fixture.ctx.isOffline=true;await render();expect(host.textContent).toContain('first recap will appear on Sunday');expect(host.textContent).toContain('browser is opened');expect(host.querySelector('dl')).toBeNull();expect(host.textContent).not.toContain('Play recap');});
it('stops recap playback when Dante Live opens',async()=>{await render();fixture.stop.mockClear();fixture.ctx.liveOpen=true;await render();expect(fixture.stop).toHaveBeenCalled();});
