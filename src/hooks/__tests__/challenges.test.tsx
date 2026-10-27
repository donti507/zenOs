// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useChallenges} from '../useChallenges';
import {LOCAL_BADGES_KEY} from '../../lib/buildBadges';
vi.mock('../../lib/localSpaces',()=>({listLocalSpaces:vi.fn(async()=>[{id:'page',remixSource:{id:'source'}}])}));
let root:Root,api:ReturnType<typeof useChallenges>,current=true;
const token=vi.fn(async()=> 'verified-token');
function Harness({owner='owner',offline=false,revision='page'}:{owner?:string|null;offline?:boolean;revision?:string}){api=useChallenges({ownerId:owner,isOffline:offline,getToken:token,isCurrent:()=>current,pageRevision:revision});return null;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;current=true;vi.clearAllMocks();localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({badges:[]})));root=createRoot(document.createElement('div'));});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('keeps local badges independent without token/network calls and disallows cloud actions',async()=>{
 await act(async()=>root.render(<Harness offline/>));expect(api.buildBadges.map(b=>b.key)).toEqual(['first_page','first_remix']);expect(localStorage.getItem(LOCAL_BADGES_KEY)).toContain('first_remix');expect(fetch).not.toHaveBeenCalled();expect(token).not.toHaveBeenCalled();await expect(api.voteChallenge('challenge','entry')).rejects.toThrow('Sign in');
});
it('sends only entry identifiers with verified auth, using separate public and scoped detail reads',async()=>{
 await act(async()=>root.render(<Harness/>));await api.voteChallenge('challenge','entry');const [url,options]=vi.mocked(fetch).mock.calls.at(-1)!;expect(url).toBe('/api/challenges/challenge/vote');expect(options?.headers).toMatchObject({Authorization:'Bearer verified-token'});expect(JSON.parse(String(options?.body))).toEqual({entryId:'entry',confirm:true});
 await api.readChallenge('challenge');expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe('/api/challenges/challenge/account');
 await act(async()=>root.render(<Harness owner={null}/>));await api.readChallenge('challenge');expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe('/api/challenges/challenge');expect(vi.mocked(fetch).mock.calls.at(-1)![1]?.headers).not.toHaveProperty('Authorization');
});
it('discards late badge responses after sign-out instead of exposing the previous account badges',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(<Harness/>));await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));current=false;await act(async()=>{root.render(<Harness owner={null}/>);});await act(async()=>finish(Response.json({badges:[{key:'challenge_winner',earnedAt:'2026-10-27'}]})));expect(api.buildBadges).toEqual([]);
});
