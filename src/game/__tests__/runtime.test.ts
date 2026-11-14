import {it,expect,vi} from 'vitest';
import {mountAdventure} from '../runtime';
import {lostBinaryKingdom} from '../samples/lost-binary-kingdom';
const mock=vi.hoisted(()=>({boot:vi.fn(()=>({destroy:vi.fn()}))}));
vi.mock('../engine/boot',()=>({bootAdventure:mock.boot}));
it('never creates a game for an invalid spec or an aborted lazy load',async()=>{
 const controller=new AbortController();const options:any={parent:{},spec:lostBinaryKingdom,signal:controller.signal,onReady:vi.fn(),onFailure:vi.fn(),onPosition:vi.fn()};
 await expect(mountAdventure({...options,spec:{...lostBinaryKingdom,code:'evil'}})).rejects.toThrow();expect(mock.boot).not.toHaveBeenCalled();const task=mountAdventure(options);controller.abort();expect(await task).toBe(null);expect(mock.boot).not.toHaveBeenCalled();
});
