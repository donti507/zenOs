import { afterEach, expect, it, vi } from 'vitest';
import { processLectureAudio, type LectureSession } from '../lectureProcessing';
const id='00000000-0000-0000-0000-000000000123';
const lecture={id,title:'server',durationSeconds:100,transcript:'Lecture text',summary:'Summary',keyPoints:['Point'],flashcards:Array.from({length:10},()=>({question:'Q',answer:'A',known:null})),actionItems:[],createdAt:new Date().toISOString()};
afterEach(()=>vi.unstubAllGlobals());
it('uploads once, renews auth before requests, consumes streamed progress and reuses the job after a failed section',async()=>{
 const session:LectureSession={};let failed=false;const request=vi.fn(async(url:string,options:any)=>{
 expect(options.headers.Authorization).toMatch(/^Bearer token-/);
 if(url.endsWith('/prepare'))return Response.json({id,chunks:2,durationSeconds:100});
 if(url.includes('/transcribe/1')&&!failed){failed=true;return Response.json({error:'Temporary failure'},{status:502});}
 if(url.endsWith('/analyze')){
 const lines=JSON.stringify({type:'progress',completed:0,total:1,message:'Writing notes'})+'\n'+JSON.stringify({type:'result',lecture})+'\n';const bytes=new TextEncoder().encode(lines);
 return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,37));c.enqueue(bytes.slice(37));c.close();}}));
 }return Response.json({text:'Speech'});
 });vi.stubGlobal('fetch',request);let token=0;const progress=vi.fn();const options={file:new Blob(['audio'],{type:'audio/webm'}),title:'My title',session,getToken:async()=>`token-${++token}`,signal:new AbortController().signal,progress};
 await expect(processLectureAudio(options)).rejects.toThrow('Temporary failure');const result=await processLectureAudio(options);expect(result.title).toBe('My title');expect(result.flashcards).toHaveLength(10);expect(request.mock.calls.filter(([url])=>url.endsWith('/prepare'))).toHaveLength(1);expect(progress).toHaveBeenCalledWith(expect.objectContaining({message:'Writing notes'}));expect(token).toBe(6);
});
it('rejects incomplete streamed analysis instead of saving partial notes',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/analyze')?new Response('{"type":"heartbeat"}\n'):Response.json({text:'speech'})));
 await expect(processLectureAudio({file:new Blob(['a']),title:'Title',session:{job:{id,chunks:1,durationSeconds:100}},getToken:async()=>null,signal:new AbortController().signal,progress:()=>{}})).rejects.toThrow('did not finish');
});
