// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useNavigate} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import DanteLive from '../DanteLive';
const fixture=vi.hoisted(()=>({status:{stt:false,ready:true,tts:false},onFinal:null as any,stream:vi.fn(),start:vi.fn(),cancel:vi.fn(),speak:vi.fn(),stateRef:{current:{danteHistory:[],tasks:[],meetings:[],categories:[],vault:[],completionLog:[]}},ctx:{} as any}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>fixture.ctx}));
vi.mock('../../hooks/useDanteStatus',()=>({useDanteStatus:()=>fixture.status}));
vi.mock('../../hooks/useSpeechRecognition',()=>({useSpeechRecognition:({onFinal}:any)=>{fixture.onFinal=onFinal;return {supported:true,listening:false,interim:'',error:null,setError:vi.fn(),start:fixture.start,stop:vi.fn(),cancel:fixture.cancel};}}));
vi.mock('../../hooks/useRecorderTranscription',()=>({useRecorderTranscription:()=>({supported:false,cancel:vi.fn()})}));
vi.mock('../../lib/dante',async(importOriginal)=>({...await importOriginal<any>(),streamDante:(...args:any[])=>fixture.stream(...args)}));
vi.mock('../DanteOrb',()=>({default:()=> <div>Orb</div>}));
let root:Root,host:HTMLDivElement,navigate:any;
const snapshot:any={page:{id:'page',slug:'study',title:'Study'},version:{id:'initial'}};
function App(){navigate=useNavigate();return <DanteLive/>;}
async function render(path='/space/study'){await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>));await act(async()=>vi.advanceTimersByTime(350));}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();fixture.status.tts=false;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 fixture.ctx={liveOpen:true,setLiveOpen:vi.fn(),stateRef:fixture.stateRef,user:{id:'owner'},isOffline:false,googleEvents:[],getAuthToken:vi.fn(async()=>null),saveDanteMessage:vi.fn(),spacePages:[snapshot.page],loadSpacePage:vi.fn(async()=>snapshot),editSpacePage:vi.fn(async()=>({...snapshot,version:{id:'saved'}})),addTask:vi.fn(),editTask:vi.fn(),toggleTaskDone:vi.fn(),addMeeting:vi.fn(),updateState:vi.fn()};
 fixture.stream.mockResolvedValue('Normal answer.');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ready:true,models:['allowed']})));
 vi.stubGlobal('SpeechSynthesisUtterance',class {text:string;constructor(text:string){this.text=text;}});
 const tts={getVoices:()=>[],addEventListener:vi.fn(),removeEventListener:vi.fn(),cancel:vi.fn(),speak:(utterance:any)=>{fixture.speak(utterance.text);utterance.onstart?.();utterance.onend?.();}};
 Object.defineProperty(window,'speechSynthesis',{value:tts,configurable:true});vi.stubGlobal('speechSynthesis',tts);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('edits the current page once and speaks only after a save point is confirmed, without invoking ordinary Dante',async()=>{
 let save:any;fixture.ctx.editSpacePage.mockImplementation(()=>new Promise(resolve=>{save=resolve;}));
 await render();expect(host.textContent).toContain('Editing “Study”');expect(fixture.start).toHaveBeenCalledTimes(1);
 await act(async()=>fixture.onFinal('make the background purple'));
 expect(fixture.ctx.editSpacePage).toHaveBeenCalledWith(snapshot,'make the background purple','allowed',expect.any(String),expect.any(AbortSignal));
 expect(fixture.speak).not.toHaveBeenCalled();expect(fixture.stream).not.toHaveBeenCalled();
 await act(async()=>fixture.onFinal('make the background purple'));expect(fixture.ctx.editSpacePage).toHaveBeenCalledTimes(1);
 await act(async()=>save({...snapshot,version:{id:'saved'}}));
 expect(fixture.speak.mock.calls.map(([text])=>text).join(' ')).toBe('Page updated. New save point created.');expect(fixture.ctx.saveDanteMessage).not.toHaveBeenCalled();
});
it('reports quota/storage failures without claiming or speaking success',async()=>{
 fixture.ctx.editSpacePage.mockRejectedValue(new Error('Daily limit reached'));
 await render();await act(async()=>fixture.onFinal('add a timer'));
 expect(host.textContent).toContain('Daily limit reached');expect(fixture.speak).not.toHaveBeenCalled();expect(fixture.ctx.addTask).not.toHaveBeenCalled();
});
it('aborts in-flight edits when navigating and ignores stale results and transcripts',async()=>{
 let finish:any;fixture.ctx.editSpacePage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await render();await act(async()=>fixture.onFinal('add a timer'));
 const signal=fixture.ctx.editSpacePage.mock.calls[0][4];
 await act(async()=>navigate('/space/other'));
 expect(signal.aborted).toBe(true);
 await act(async()=>fixture.onFinal('late recording'));expect(fixture.ctx.editSpacePage).toHaveBeenCalledTimes(1);
 await act(async()=>finish({...snapshot,version:{id:'late'}}));expect(fixture.speak).not.toHaveBeenCalled();
});
it('aborts on account changes and close',async()=>{
 let finish:any;fixture.ctx.editSpacePage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await render();await act(async()=>fixture.onFinal('add a timer'));
 const signal=fixture.ctx.editSpacePage.mock.calls[0][4];
 fixture.ctx={...fixture.ctx,user:{id:'other'},liveOpen:false};
 await act(async()=>root.render(<MemoryRouter><App/></MemoryRouter>));
 expect(signal.aborted).toBe(true);await act(async()=>finish(snapshot));expect(fixture.speak).not.toHaveBeenCalled();
});
it('keeps normal Dante conversation on Home and the My Space list',async()=>{
 await render('/space');await act(async()=>fixture.onFinal('create a task'));
 expect(fixture.stream).toHaveBeenCalledOnce();expect(fixture.ctx.editSpacePage).not.toHaveBeenCalled();
 await act(async()=>navigate('/'));await act(async()=>vi.advanceTimersByTime(350));
 await act(async()=>fixture.onFinal('what is next'));
 expect(fixture.stream).toHaveBeenCalledTimes(2);expect(fixture.ctx.editSpacePage).not.toHaveBeenCalled();
});

it('uses authenticated server speech for streamed Live replies when configured',async()=>{
 fixture.status.tts=true;fixture.ctx.getAuthToken.mockResolvedValue('verified-token');
 vi.stubGlobal('Audio',class{onplaying:any;onended:any;pause(){}load(){}removeAttribute(){}play=async()=>{this.onplaying?.();queueMicrotask(()=>this.onended?.());};});
 const createUrl=vi.fn(()=> 'blob:server-voice');Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createUrl});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 vi.mocked(fetch).mockImplementation(async(url:any)=>String(url)==='/api/tts'?new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}}):Response.json({ready:true,models:['allowed']}));
 fixture.stream.mockImplementation(async(options:any)=>{options.onText('First sentence. Second sentence.');return 'First sentence. Second sentence.';});
 await render('/');await act(async()=>fixture.onFinal('say hello'));for(let i=0;i<10;i++)await act(async()=>{await Promise.resolve();});
 expect(vi.mocked(fetch).mock.calls.some(([url,options])=>url==='/api/tts'&&(options?.headers as any).Authorization==='Bearer verified-token')).toBe(true);expect(createUrl).toHaveBeenCalled();expect(fixture.speak).not.toHaveBeenCalled();
});
it('keeps configured server speech off in local mode',async()=>{fixture.status.tts=true;fixture.ctx.isOffline=true;await render('/space/study');await act(async()=>fixture.onFinal('add a timer'));expect(vi.mocked(fetch).mock.calls.some(([url])=>url==='/api/tts')).toBe(false);expect(fixture.speak.mock.calls.map(([text])=>text).join(' ')).toBe('Page updated. New save point created.');});
