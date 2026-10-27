// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {readArenaStream,voteLocalArena,localArenaVotes} from '../arena';
const id='10000000-0000-0000-0000-000000000001';
afterEach(()=>localStorage.clear());
it('decodes split UTF-8/JSON stream chunks and requires a terminal event',async()=>{
 const text=JSON.stringify({type:'delta',side:0,text:'Zażółć 😊'})+'\n'+JSON.stringify({type:'complete',id})+'\n';const data=new TextEncoder().encode(text);
 const response=new Response(new ReadableStream({start(controller){for(const byte of data)controller.enqueue(new Uint8Array([byte]));controller.close();}}));const events:any[]=[];
 await readArenaStream(response,new AbortController().signal,event=>events.push(event));expect(events[0].text).toBe('Zażółć 😊');expect(events[1].id).toBe(id);
 await expect(readArenaStream(new Response('{"type":"delta","side":0,"text":"partial"}\n'),new AbortController().signal,()=>{})).rejects.toThrow('interrupted');
 await expect(readArenaStream(new Response('{"type":"delta","side":8,"text":"bad"}\n'),new AbortController().signal,()=>{})).rejects.toThrow('Invalid');
});
it('persists one immutable local vote per comparison and never stores prompts or answers',()=>{
 const vote:any={id,models:['alpha','beta'],winner:'a',prompt:'PRIVATE',answers:['PRIVATE']};
 expect(voteLocalArena(vote)).toEqual([{model:'alpha',wins:1,comparisons:1},{model:'beta',wins:0,comparisons:1}]);voteLocalArena(vote);
 expect(localArenaVotes()).toHaveLength(1);expect(localStorage.getItem('zenos_arena_votes')).not.toContain('PRIVATE');expect(()=>voteLocalArena({...vote,winner:'b'})).toThrow('already recorded');
});
