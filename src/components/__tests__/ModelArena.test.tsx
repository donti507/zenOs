// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import ModelArena from '../ModelArena';
const ctx=vi.hoisted(()=>({user:{id:'local'},isOffline:true,arenaRound:null as any,arenaLeaderboard:[] as any[],arenaRunning:false,arenaVoting:false,compareArena:vi.fn(),cancelArena:vi.fn(),voteArena:vi.fn(async()=>{}),refreshArenaLeaderboard:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>ctx}));
it('renders side-by-side escaped streamed answers, enables one vote after completion and shows only the private leaderboard',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ready:true,cloudReady:true,models:['alpha','beta']})));
 const host=document.createElement('div'),root=createRoot(host);
 try{
 await act(async()=>root.render(<ModelArena/>));expect(host.textContent).toContain('2 Dante messages');expect(host.textContent).toContain('your votes');
 ctx.arenaRound={id:'round',models:['alpha','beta'],answers:['<script>secret()</script>','Second answer'],states:['streaming','done'],eligible:false,winner:null};ctx.arenaRunning=true;
 await act(async()=>root.render(<ModelArena/>));expect(host.querySelector('script')).toBeNull();expect(host.textContent).toContain('<script>secret()</script>');
 const buttons=()=>Array.from(host.querySelectorAll('button')).filter(button=>button.textContent?.startsWith('Vote for'));expect(buttons().every(button=>button.disabled)).toBe(true);
 ctx.arenaRunning=false;ctx.arenaRound={...ctx.arenaRound,states:['done','done'],eligible:true};await act(async()=>root.render(<ModelArena/>));
 await act(async()=>buttons()[0].click());expect(ctx.voteArena).toHaveBeenCalledWith('a');
 ctx.arenaRound={...ctx.arenaRound,winner:'a'};ctx.arenaLeaderboard=[{model:'alpha',wins:1,comparisons:1},{model:'beta',wins:0,comparisons:1}];await act(async()=>root.render(<ModelArena/>));expect(host.textContent).toContain('Your vote is saved');expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
