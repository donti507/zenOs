// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLectureRecorder } from '../useLectureRecorder';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;let hook:ReturnType<typeof useLectureRecorder>;const saved=vi.fn();const stopTrack=vi.fn();let latest:FakeRecorder;
class FakeRecorder{
 static isTypeSupported=()=>true;state='inactive';mimeType='audio/webm';ondataavailable:any;onstop:any;onerror:any;
 constructor(){latest=this;}
 start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}
}
function Harness({identity='a'}:{identity?:string}){hook=useLectureRecorder(saved,identity);return null;}
beforeEach(async()=>{saved.mockReset();stopTrack.mockReset();vi.useFakeTimers();vi.stubGlobal('MediaRecorder',FakeRecorder);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:stopTrack}]}))}});root=createRoot(document.createElement('div'));await act(async()=>root.render(<Harness/>));});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();});
it('records a complete playable container and stops microphone tracks at the 60-minute limit',async()=>{
 await act(async()=>{await hook.start();});expect(hook.recording).toBe(true);
 await act(async()=>{vi.advanceTimersByTime(3600000);});expect(hook.recording).toBe(false);expect(saved).toHaveBeenCalledTimes(1);expect(saved.mock.calls[0][0]).toBeInstanceOf(File);expect(stopTrack).toHaveBeenCalled();
});
it('drops recordings on account change and avoids duplicate microphone requests',async()=>{
 await act(async()=>{await Promise.all([hook.start(),hook.start()]);});expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
 await act(async()=>root.render(<Harness identity="b"/>));expect(saved).not.toHaveBeenCalled();expect(latest.state).toBe('inactive');expect(stopTrack).toHaveBeenCalled();
});
it('releases an asynchronously granted microphone after unmount without recording',async()=>{
 let finish:any;vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 let opening:Promise<void>;await act(async()=>{opening=hook.start();});await act(async()=>root.unmount());finish({getTracks:()=>[{stop:stopTrack}]});await opening!;expect(stopTrack).toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
});
