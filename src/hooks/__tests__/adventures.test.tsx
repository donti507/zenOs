// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {useAdventures} from '../useAdventures';
it('loads only supported sample data and persists bounded settings without touching local task data',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();localStorage.setItem('zenos_tasks','[{"title":"Keep this"}]');localStorage.setItem('zenos_adventure_settings_v1','{"lowPerformance":"true","reducedMotion":false,"script":"evil"}');
 let ctx:ReturnType<typeof useAdventures>;function Consumer(){ctx=useAdventures();return null;}const root=createRoot(document.createElement('div'));
 try{await act(async()=>root.render(<Consumer/>));expect(ctx.adventureSettings).toEqual({lowPerformance:false,reducedMotion:false});await expect(ctx.loadAdventure('../evil')).rejects.toThrow('not found');expect((await ctx.loadAdventure('lost-binary-kingdom')).specVersion).toBe(1);await act(async()=>ctx.setAdventureSettings({lowPerformance:true}));expect(JSON.parse(localStorage.getItem('zenos_adventure_settings_v1')!)).toEqual({lowPerformance:true,reducedMotion:false});expect(localStorage.getItem('zenos_tasks')).toContain('Keep this');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Blocked');});await act(async()=>ctx.setAdventureSettings({reducedMotion:true}));expect(ctx.adventureSettings.reducedMotion).toBe(true);}finally{await act(async()=>root.unmount());vi.restoreAllMocks();}
});
