import {afterEach,expect,it,vi} from 'vitest';
import {editSpaceByVoice,spaceVoiceSlug,spaceVoiceConfirmation} from '../spaceVoice';
const snapshot:any={page:{id:'owned-page',slug:'study'},version:{id:'base'}};
const options=()=>({slug:'study',pageId:'owned-page',instruction:'make the background purple',isOffline:false,signal:new AbortController().signal,isCurrent:()=>true,loadSpacePage:vi.fn(async()=>snapshot),editSpacePage:vi.fn(async()=>snapshot)});
afterEach(()=>vi.unstubAllGlobals());
const status=(data:any={ready:true,models:['allowed','other'],authRequired:true})=>vi.stubGlobal('fetch',vi.fn(async()=>Response.json(data)));
it('targets only concrete personal-page routes and uses short confirmations for supported voice languages',()=>{
 expect(spaceVoiceSlug('/space/study')).toBe('study');expect(spaceVoiceSlug('/space/study/')).toBe('study');
 for(const path of ['/','/space','/space/','/space/study/extra','/space/%2Fadmin','/space/UPPER']) expect(spaceVoiceSlug(path)).toBeNull();
 for(const lang of ['en-US','pl-PL','de-DE','es-ES','fr-FR','uk-UA']) expect(spaceVoiceConfirmation(lang).length).toBeLessThan(80);
 expect(spaceVoiceConfirmation('xx')).toBe(spaceVoiceConfirmation('en-US'));
});
it('loads owned canonical code and delegates to the existing quota-metered save flow with an allowed model',async()=>{
 status();const opts=options();await editSpaceByVoice(opts);
 expect(opts.loadSpacePage).toHaveBeenCalledWith('study');
 expect(opts.editSpacePage).toHaveBeenCalledWith(snapshot,opts.instruction,'allowed',expect.stringMatching(/^[0-9a-f-]{36}$/),opts.signal);
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('/api/space/status',expect.objectContaining({signal:opts.signal}));
});
it('rejects invalid instructions, missing configuration, wrong page identity and local auth requirements before editing',async()=>{
 for(const instruction of ['', 'x'.repeat(2001),{}]) {status();const opts={...options(),instruction:instruction as string};await expect(editSpaceByVoice(opts)).rejects.toThrow('Invalid page instruction');expect(opts.editSpacePage).not.toHaveBeenCalled();}
 for(const data of [{ready:false},{ready:true,models:['https://foreign']},{ready:true,models:[]},{ready:true,models:['a','b','c','d']}]){status(data);const opts=options();await expect(editSpaceByVoice(opts)).rejects.toThrow();expect(opts.editSpacePage).not.toHaveBeenCalled();}
 status();const local={...options(),isOffline:true};await expect(editSpaceByVoice(local)).rejects.toThrow('Sign in');expect(local.editSpacePage).not.toHaveBeenCalled();
 const wrong={...options(),pageId:'recreated-page'};await expect(editSpaceByVoice(wrong)).rejects.toThrow('page changed');expect(wrong.editSpacePage).not.toHaveBeenCalled();
});
it('ignores late loads after navigation/account changes and propagates cancellation and quota failures',async()=>{
 status();let current=true;const opts={...options(),isCurrent:()=>current};opts.loadSpacePage.mockImplementation(async()=>{current=false;return snapshot;});
 await expect(editSpaceByVoice(opts)).rejects.toMatchObject({name:'AbortError'});expect(opts.editSpacePage).not.toHaveBeenCalled();
 const controller=new AbortController();controller.abort();await expect(editSpaceByVoice({...options(),signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
 const quota=options();quota.editSpacePage.mockRejectedValue(new Error('Daily limit reached'));
 await expect(editSpaceByVoice(quota)).rejects.toThrow('Daily limit reached');expect(quota.editSpacePage).toHaveBeenCalledTimes(1);
});
