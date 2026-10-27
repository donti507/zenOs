// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useModelArena} from '../useModelArena';
const mock=vi.hoisted(()=>({rpc:vi.fn(async()=>({data:[],error:null}))}));
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
let root:Root,api:ReturnType<typeof useModelArena>;const getToken=async()=>null;
const id='10000000-0000-0000-0000-000000000001';
function Harness({owner='local',offline=true}:{owner?:string;offline?:boolean}){api=useModelArena({ownerId:owner,isOffline:offline,getToken,isCurrent:()=>true});return null;}
const line=(value:any)=>JSON.stringify(value)+'\n';
const complete=()=>new Response(line({type:'delta',side:0,text:'Answer alpha'})+line({type:'delta',side:1,text:'Answer beta'})+line({type:'done',side:0})+line({type:'done',side:1})+line({type:'complete',id}));
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();mock.rpc.mockClear();root=createRoot(document.createElement('div'));vi.stubGlobal('fetch',vi.fn(async()=>complete()));await act(async()=>root.render(<Harness/>));});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('streams both answers, saves a local vote once and reloads a private leaderboard without cloud access',async()=>{
 await act(async()=>api.compareArena('Compare these ideas',['alpha','beta']));expect(api.arenaRound).toMatchObject({eligible:true,answers:['Answer alpha','Answer beta'],id});
 await act(async()=>api.voteArena('b'));expect(api.arenaRound?.winner).toBe('b');expect(api.arenaLeaderboard[0]).toMatchObject({model:'beta',wins:1});
 await expect(api.voteArena('a')).rejects.toThrow('not available');expect(mock.rpc).not.toHaveBeenCalled();
 await act(async()=>root.unmount());root=createRoot(document.createElement('div'));await act(async()=>root.render(<Harness/>));
 expect(api.arenaLeaderboard[0]).toMatchObject({model:'beta',wins:1});expect(api.arenaRound).toBeNull();
 expect(vi.mocked(fetch).mock.calls[0][1]!.body).toBe(JSON.stringify({prompt:'Compare these ideas',models:['alpha','beta']}));
});
it('keeps partial answers but forbids voting after an interrupted/failed stream',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(new Response(line({type:'delta',side:0,text:'partial'})));
 await act(async()=>api.compareArena('question',['alpha','beta']));expect(api.arenaRound?.answers[0]).toBe('partial');expect(api.arenaRound?.eligible).toBe(false);expect(api.arenaError).toContain('interrupted');await expect(api.voteArena('a')).rejects.toThrow('not available');
});
it('aborts on cancellation/account changes and rejects old-account voting callbacks',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));let pending:any;
 await act(async()=>{pending=api.compareArena('question',['alpha','beta']);});const signal=vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;const old=api;
 await act(async()=>root.render(<Harness owner="cloud-owner" offline={false}/>));expect(signal.aborted).toBe(true);
 await act(async()=>{finish(complete());await pending;});expect(api.arenaRound).toBeNull();expect(api.arenaLeaderboard).toEqual([]);await expect(old.voteArena('a')).rejects.toThrow('not available');
});
it('prevents a concurrent second comparison and exposes quota errors without creating a votable round',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'You need 2 remaining messages'},{status:429}));
 await act(async()=>api.compareArena('question',['alpha','beta']));expect(api.arenaError).toContain('2 remaining');expect(api.arenaRound?.eligible).toBe(false);
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));let pending:any;
 await act(async()=>{pending=api.compareArena('question',['alpha','beta']);});await expect(api.compareArena('another',['alpha','beta'])).rejects.toThrow('already running');
 await act(async()=>{api.cancelArena();finish(complete());await pending;});expect(api.arenaRound?.eligible).toBe(false);expect(api.arenaRunning).toBe(false);
});
