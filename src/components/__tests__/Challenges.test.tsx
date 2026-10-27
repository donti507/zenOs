// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import Challenges from '../../pages/Challenges';
const ctx=vi.hoisted(()=>({user:{id:'owner'} as any,isOffline:false,state:{theme:'light'},toggleTheme:vi.fn(),getGalleryAccount:vi.fn(),buildBadges:[{key:'first_page',earnedAt:'2026-10-27'}],listChallenges:vi.fn(),readChallenge:vi.fn(),createChallenge:vi.fn(),challengePublications:vi.fn(),submitChallenge:vi.fn(),voteChallenge:vi.fn(),refreshBuildBadges:vi.fn(async()=>{})}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
const id='10000000-0000-0000-0000-000000000001',entry='20000000-0000-0000-0000-000000000001',page='30000000-0000-0000-0000-000000000001';
const challenge={id,title:'Timer week',description:'Build a useful timer',startsAt:new Date(Date.now()-86400000).toISOString(),endsAt:new Date(Date.now()+6*86400000).toISOString(),finalized:false};
let root:Root,host:HTMLDivElement;
const click=async(text:string)=>act(async()=>{Array.from(document.body.querySelectorAll('button')).find(button=>button.textContent===text)!.click();});
const render=async(path='/gallery/challenges/'+id)=>act(async()=>root.render(<MemoryRouter initialEntries={[path]}><Challenges/></MemoryRouter>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();ctx.user={id:'owner'};ctx.isOffline=false;ctx.getGalleryAccount.mockResolvedValue({isAdmin:false});ctx.listChallenges.mockResolvedValue({challenges:[challenge],hasMore:false});ctx.readChallenge.mockResolvedValue({challenge,entries:[{id:entry,pageId:page,title:'Alice timer',author:'Alice',votes:2,winner:false}],myVote:null,myEntry:null});ctx.challengePublications.mockResolvedValue([{id:page,title:'My page'}]);ctx.submitChallenge.mockResolvedValue({id:entry});ctx.voteChallenge.mockResolvedValue({ok:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('requires a separate permanent-vote confirmation and displays account badges',async()=>{
 await render();expect(host.textContent).toContain('First page');await click('Vote for this page');expect(ctx.voteChallenge).not.toHaveBeenCalled();expect(document.body.textContent).toContain('cannot change it');await click('Cast permanent vote');expect(ctx.voteChallenge).toHaveBeenCalledWith(id,entry);
});
it('lists only owned publication choices and requires submission confirmation',async()=>{
 await render();await click('Submit a published page');expect(ctx.submitChallenge).not.toHaveBeenCalled();expect(document.body.querySelector('select')?.textContent).toBe('My page');await click('Confirm submission');expect(ctx.submitChallenge).toHaveBeenCalledWith(id,page);
});
it('keeps browsing public but hides submission/voting/admin controls in local and signed-out modes',async()=>{
 ctx.isOffline=true;await render();expect(host.textContent).toContain('Alice timer');expect(host.textContent).not.toContain('Vote for this page');expect(host.textContent).not.toContain('Submit a published page');expect(host.textContent).not.toContain('Create challenge');expect(ctx.challengePublications).not.toHaveBeenCalled();
});
it('shows the admin create form only after server authorization and disables empty inputs',async()=>{
 ctx.getGalleryAccount.mockResolvedValue({isAdmin:true});await render('/gallery/challenges');await click('Create challenge');const dialog=document.body.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain('Starts (your timezone)');expect(Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='Create challenge')!.disabled).toBe(true);expect(ctx.createChallenge).not.toHaveBeenCalled();
});
it('shows final winners without vote or submission controls',async()=>{
 ctx.readChallenge.mockResolvedValue({challenge:{...challenge,finalized:true,endsAt:new Date(Date.now()-1000).toISOString()},entries:[{id:entry,pageId:page,title:'Alice timer',author:'Alice',votes:2,winner:true}],myVote:entry,myEntry:null});await render();expect(host.textContent).toContain('Results are final');expect(host.textContent).toContain('2 votes · Winner');expect(host.textContent).toContain('cannot be changed');expect(host.textContent).not.toContain('Vote for this page');
});
