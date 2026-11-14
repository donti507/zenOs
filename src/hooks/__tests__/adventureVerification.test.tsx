// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {useAdventures} from '../useAdventures';
const mock=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('../../game/samples/local-verifier',()=>({verifyLocalSample:mock.verify}));
let root:Root,ctx:ReturnType<typeof useAdventures>;
function Consumer({owner}:{owner:string}){ctx=useAdventures({ownerId:owner});return null;}
const id='lost-binary-kingdom',answer={type:'sequence',order:[1,3,2,0]};
const ready=async()=>{await ctx.loadAdventure(id);await act(async()=>ctx.advanceAdventureQuest(id,{type:'accept',missionId:'power-path'}));};
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mock.verify.mockReset();root=createRoot(document.createElement('div'));await act(async()=>root.render(<Consumer owner="alice"/>));await ready();});
afterEach(async()=>{await act(async()=>root.unmount());});
it('blocks concurrent submissions and makes aborts leave XP, attempts and unlocks untouched',async()=>{
 let resolve!:(v:any)=>void;mock.verify.mockImplementation(()=>new Promise(r=>resolve=r));const controller=new AbortController();const pending=ctx.submitAdventurePuzzle(id,'power-path',answer,controller.signal);await vi.waitFor(()=>expect(mock.verify).toHaveBeenCalledOnce());expect(await ctx.submitAdventurePuzzle(id,'power-path',answer)).toBe(null);controller.abort();resolve({correct:true,code:'correct'});expect(await pending).toBe(null);expect(ctx.adventureProgress[id].completed).toEqual([]);expect(ctx.adventurePuzzleStats[id]).toBeUndefined();
});
it('rejects stale completions after an account changes away and back to the same owner',async()=>{
 let resolve!:(v:any)=>void;mock.verify.mockImplementation(()=>new Promise(r=>resolve=r));const oldSubmit=ctx.submitAdventurePuzzle,pending=oldSubmit(id,'power-path',answer);await vi.waitFor(()=>expect(mock.verify).toHaveBeenCalledOnce());await act(async()=>root.render(<Consumer owner="bob"/>));await act(async()=>root.render(<Consumer owner="alice"/>));await ready();resolve({correct:true,code:'correct'});expect(await pending).toBe(null);expect(await oldSubmit(id,'power-path',answer)).toBe(null);expect(ctx.adventureProgress[id].completed).toEqual([]);
});
it('sanitizes verifier errors and releases the lock for a retry',async()=>{
 mock.verify.mockRejectedValueOnce(new Error('SECRET ANSWER DATA'));await expect(ctx.submitAdventurePuzzle(id,'power-path',answer)).rejects.toThrow('Could not check this puzzle. Please try again.');expect(ctx.adventureProgress[id].completed).toEqual([]);mock.verify.mockResolvedValueOnce({correct:true,code:'correct'});await act(async()=>{expect((await ctx.submitAdventurePuzzle(id,'power-path',answer))?.xpGranted).toBe(20);});
});
it('allows an immediate retry after abort without a late old check releasing the new lock',async()=>{
 let first!:(v:any)=>void,second!:(v:any)=>void;mock.verify.mockImplementationOnce(()=>new Promise(r=>first=r)).mockImplementationOnce(()=>new Promise(r=>second=r));const controller=new AbortController(),old=ctx.submitAdventurePuzzle(id,'power-path',answer,controller.signal);await vi.waitFor(()=>expect(mock.verify).toHaveBeenCalledTimes(1));controller.abort();const retry=ctx.submitAdventurePuzzle(id,'power-path',answer);await vi.waitFor(()=>expect(mock.verify).toHaveBeenCalledTimes(2));first({correct:true,code:'correct'});expect(await old).toBe(null);expect(await ctx.submitAdventurePuzzle(id,'power-path',answer)).toBe(null);await act(async()=>{second({correct:true,code:'correct'});expect((await retry)?.xpGranted).toBe(20);});
});
