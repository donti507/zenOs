import {expect,it,vi} from 'vitest';
const provider=vi.hoisted(()=>({output:'',messages:[] as any[]}));
vi.mock('../llm',async(importOriginal)=>({...await importOriginal<any>(),streamChat:async function*(_config:any,messages:any){provider.messages=messages;yield provider.output;}}));
import {generateSpaceDraft,SPACE_SYSTEM} from '../space';
import {initialSpaceCode} from '../../shared/space';
const generate=()=>generateSpaceDraft({} as any,'allowed',initialSpaceCode,[],'Add a title',new AbortController().signal);
it('requests and validates a plain-language explanation in the same quota-metered generation',async()=>{
 provider.output=JSON.stringify({html:'<h1>Title</h1>',css:'',js:'',reply:'Done',explanation:'Added a heading to give the page a clear title.'});
 expect((await generate()).explanation).toContain('clear title');
 expect(SPACE_SYSTEM).toContain('what code changed and why');
 expect(JSON.parse(provider.messages[1].content).current).toEqual(initialSpaceCode);
});
it('rejects missing, blank and oversized provider explanations',async()=>{
 for(const explanation of [undefined,' ','x'.repeat(1201),{html:'bad'}]){
 provider.output=JSON.stringify({html:'',css:'',js:'',reply:'Done',explanation});
 await expect(generate()).rejects.toThrow('Invalid explanation');
 }
});
