import { expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { stat, readFile, rm, access } from 'node:fs/promises';
import { prepareLectureAudio } from '../lectureAudio';
function wav(seconds:number){
 const data=Buffer.alloc(seconds*16000*2+44);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);return data;
}
it('uses real FFmpeg to produce standalone WAV sections below 10 MB without losing duration',async()=>{
 const prepared=await prepareLectureAudio(Readable.from(wav(601)),new AbortController().signal);
 try{expect(prepared.chunks).toHaveLength(3);expect(prepared.duration).toBeCloseTo(601,1);
 for(const chunk of prepared.chunks){expect((await stat(chunk)).size).toBeLessThan(10_000_000);expect((await readFile(chunk)).subarray(0,4).toString()).toBe('RIFF');}
 await expect(access(`${prepared.root}/input.audio`)).rejects.toThrow();
 }finally{await rm(prepared.root,{recursive:true,force:true});}
},30000);
it('rejects non-audio and recordings longer than 60 minutes',async()=>{
 await expect(prepareLectureAudio(Readable.from(Buffer.alloc(2000)),new AbortController().signal)).rejects.toThrow();
 await expect(prepareLectureAudio(Readable.from(wav(3601)),new AbortController().signal)).rejects.toThrow('60 minutes');
},30000);
it('cancels conversion when its owner leaves',async()=>{
 const abort=new AbortController();abort.abort();await expect(prepareLectureAudio(Readable.from(wav(1)),abort.signal)).rejects.toThrow();
});
