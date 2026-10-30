// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {finishUsosAuth} from '../usosAuth';
const fragment=(char:string)=>'#'+new URLSearchParams({token_hash:char.repeat(64),type:'magiclink',state:char.repeat(43)});
it('checks the browser-bound server handoff before OTP, deduplicates concurrent completion and never persists the hash',async()=>{
 const verifyOtp=vi.fn(async()=>({data:{session:{access_token:'signed'}},error:null})),client={auth:{verifyOtp}} as any;
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const request=vi.fn<typeof fetch>(async()=>{await gate;return new Response('{"ok":true}');});
 const first=finishUsosAuth(fragment('a'),{client,request,configured:true}),second=finishUsosAuth(fragment('a'),{client,request,configured:true});expect(first).toBe(second);expect(verifyOtp).not.toHaveBeenCalled();release();await first;expect(request).toHaveBeenCalledTimes(1);expect(verifyOtp).toHaveBeenCalledWith({token_hash:'a'.repeat(64),type:'magiclink'});expect(JSON.stringify(localStorage)).not.toContain('a'.repeat(64));
});
it('rejects injected, duplicated or malformed fragments and disabled configuration without OTP or server requests',async()=>{
 const client={auth:{verifyOtp:vi.fn()}},request=vi.fn();for(const value of ['',fragment('b')+'&type=recovery',fragment('b')+'&access_token=attacker',fragment('b').replace('magiclink','recovery')])await expect(finishUsosAuth(value,{client:client as any,request,configured:true})).rejects.toThrow();await expect(finishUsosAuth(fragment('b'),{client:client as any,request,configured:false})).rejects.toThrow('not configured');expect(request).not.toHaveBeenCalled();expect(client.auth.verifyOtp).not.toHaveBeenCalled();
});
it('never verifies OTP on an expired, reused or cookie-mismatched handoff and sanitizes SDK errors',async()=>{
 const verifyOtp=vi.fn(async()=>({data:{session:null},error:new Error('SECRET')})),client={auth:{verifyOtp}} as any;
 await expect(finishUsosAuth(fragment('c'),{client,configured:true,request:vi.fn(async()=>new Response('{"error":"csrf"}',{status:400})) as any})).rejects.toThrow('another browser');expect(verifyOtp).not.toHaveBeenCalled();
 await expect(finishUsosAuth(fragment('d'),{client,configured:true,request:vi.fn(async()=>new Response('{"ok":true}')) as any})).rejects.toThrow('expired');
});
