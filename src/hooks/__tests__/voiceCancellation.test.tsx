// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useSpeechRecognition} from '../useSpeechRecognition';
import {useRecorderTranscription} from '../useRecorderTranscription';
let api:any,root:Root,host:HTMLDivElement;let recognizers:any[],recorders:any[];
const onFinal=vi.fn();const track={stop:vi.fn()};const stream={getTracks:()=>[track]};
function Harness({kind}:{kind:'browser'|'server'}){
 const browser=useSpeechRecognition({lang:'en-US',onFinal});
 const server=useRecorderTranscription({lang:'en-US',onFinal,getToken:async()=>null});
 api=kind==='browser'?browser:server;return null;
}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;recognizers=[];recorders=[];onFinal.mockClear();track.stop.mockClear();
 host=document.createElement('div');root=createRoot(host);
 Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
 vi.stubGlobal('SpeechRecognition',class {onstart:any;onend:any;onresult:any;onerror:any;constructor(){recognizers.push(this);}start(){this.onstart?.();}abort(){}stop(){this.onend?.();}});
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(async()=>stream)}});
 vi.stubGlobal('MediaRecorder',class {static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';onstart:any;onstop:any;stopped:any;constructor(){recorders.push(this);}start(){this.state='recording';this.onstart?.();}stop(){this.state='inactive';this.stopped=this.onstop?.();}});
 vi.stubGlobal('AudioContext',class {createAnalyser(){return {fftSize:1024,getByteTimeDomainData:(data:Uint8Array)=>data.fill(140)};}createMediaStreamSource(){return {connect:vi.fn()};}close(){return Promise.resolve();}});
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({text:'new command'})));
});
afterEach(async()=>{await act(async()=>root.unmount());delete (navigator as any).mediaDevices;vi.unstubAllGlobals();});
it('ignores old browser-recognition callbacks after cancelling and restarting',async()=>{
 await act(async()=>root.render(<Harness kind="browser"/>));await act(async()=>api.start());const old=recognizers[0];
 const result=(text:string)=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});
 await act(async()=>old.onresult(result('old command')));
 await act(async()=>{api.cancel();api.start();});const current=recognizers[1];
 await act(async()=>{old.onresult(result('late command'));old.onend();});expect(onFinal).not.toHaveBeenCalled();
 await act(async()=>{current.onresult(result('new command'));current.onend();});expect(onFinal).toHaveBeenCalledExactlyOnceWith('new command');
});
it('aborts transcription and ignores a late response even if a new recording has already started',async()=>{
 let finish:any;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>root.render(<Harness kind="server"/>));await act(async()=>api.start());
 await act(async()=>api.stop());expect(fetch).toHaveBeenCalledOnce();const signal=vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;
 await act(async()=>{api.cancel();await api.start();});expect(signal.aborted).toBe(true);
 await act(async()=>{finish(Response.json({text:'old command'}));await recorders[0].stopped;});expect(onFinal).not.toHaveBeenCalled();
 await act(async()=>{api.stop();await recorders[1].stopped;});expect(onFinal).toHaveBeenCalledExactlyOnceWith('new command');
});
it('releases a microphone stream granted after cancellation without starting a recorder',async()=>{
 let grant:any;vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(()=>new Promise(resolve=>{grant=resolve;}));
 await act(async()=>root.render(<Harness kind="server"/>));let starting:any;
 await act(async()=>{starting=api.start();});await act(async()=>api.cancel());
 await act(async()=>{grant(stream);await starting;});expect(recorders).toHaveLength(0);expect(track.stop).toHaveBeenCalledOnce();
});
