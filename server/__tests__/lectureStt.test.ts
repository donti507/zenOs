import { expect, it, vi } from 'vitest';
import { transcribeAudio } from '../stt';
const config={model:'whisper',baseUrl:'https://speech.example/v1',apiKey:'server-secret'};
it('shares the existing STT multipart protocol with lecture WAV chunks and language detection',async()=>{
 const request=vi.fn(async(url:any,options:any)=>{
 expect(url).toBe('https://speech.example/v1/audio/transcriptions');expect(options.headers.Authorization).toBe('Bearer server-secret');expect(options.body.get('model')).toBe('whisper');expect(options.body.get('language')).toBe('pl');expect(options.body.get('file').name).toBe('speech.wav');expect(options.body.get('file').type).toBe('audio/wav');return Response.json({text:'  ATP carries energy.  '});
 });expect(await transcribeAudio(Buffer.alloc(2000),'audio/wav','pl-PL',undefined,config,request)).toBe('ATP carries energy.');
});
it('keeps provider error bodies private and propagates cancellation',async()=>{
 await expect(transcribeAudio(Buffer.alloc(2000),'audio/wav','',undefined,config,async()=>new Response('server-secret',{status:500}))).rejects.toThrow('could not process');
 const abort=new AbortController();abort.abort();await expect(transcribeAudio(Buffer.alloc(2000),'audio/wav','',abort.signal,config,async(_url,options)=>{options?.signal?.throwIfAborted();return Response.json({text:'x'});})).rejects.toThrow();
});
