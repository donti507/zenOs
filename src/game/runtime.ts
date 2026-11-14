import {validateAdventureSpec} from './spec';
import type {EngineHandle,EngineOptions} from './engine/boot';
/** An abort before the lazy module resolves must never leave a canvas or game loop behind. */
export async function mountAdventure(options:Omit<EngineOptions,'spec'>&{spec:unknown;signal:AbortSignal}):Promise<EngineHandle|null>{
 const spec=validateAdventureSpec(options.spec);if(options.signal.aborted)return null;
 const {bootAdventure}=await import('./engine/boot');if(options.signal.aborted)return null;
 return bootAdventure({...options,spec});
}
