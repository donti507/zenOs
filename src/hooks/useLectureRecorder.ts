import { useEffect, useRef, useState } from 'react';
import { MAX_LECTURE_BYTES, MAX_LECTURE_SECONDS } from '../../shared/lectures';
export function useLectureRecorder(onAudio:(file:File)=>void,identity=''){
 const generation=useRef(0);const opening=useRef(false);
 const callback=useRef(onAudio);callback.current=onAudio;
 const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);const alive=useRef(true);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const clock=useRef<ReturnType<typeof setInterval>|null>(null);
 const [recording,setRecording]=useState(false);const [starting,setStarting]=useState(false);const [elapsed,setElapsed]=useState(0);const [error,setError]=useState('');
 const release=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(timer.current)clearTimeout(timer.current);if(clock.current)clearInterval(clock.current);};
 const stop=()=>{if(recorder.current?.state==='recording')recorder.current.stop();};
 const start=async()=>{
  if(opening.current||recorder.current?.state==='recording')return;opening.current=true;const version=generation.current;setError('');setStarting(true);
  try{
   if(typeof MediaRecorder==='undefined'||!navigator.mediaDevices?.getUserMedia)throw new Error('Recording needs HTTPS and a supported browser. You can upload audio instead.');
   const captured=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current||version!==generation.current){captured.getTracks().forEach(track=>track.stop());return;}stream.current=captured;
   const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   const rec=new MediaRecorder(captured,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});recorder.current=rec;
   const parts:Blob[]=[];let bytes=0;let failed=false;const began=Date.now();
   rec.ondataavailable=event=>{if(version!==generation.current)return;if(event.data.size){parts.push(event.data);bytes+=event.data.size;if(bytes>MAX_LECTURE_BYTES){failed=true;setError('Recording reached the 1 GB limit.');stop();}}};
   rec.onerror=()=>{failed=true;if(alive.current&&version===generation.current)setError('Recording failed. Try uploading audio instead.');if(recorder.current===rec)release();else captured.getTracks().forEach(track=>track.stop());if(alive.current&&version===generation.current)setRecording(false);};
   rec.onstop=()=>{if(recorder.current===rec)release();else captured.getTracks().forEach(track=>track.stop());if(!alive.current||version!==generation.current)return;setRecording(false);if(!failed&&bytes){const type=rec.mimeType||mime||'audio/webm';const extension=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';callback.current(new File(parts,`Lecture.${extension}`,{type}));}};
   rec.start(1000);setElapsed(0);setRecording(true);
   clock.current=setInterval(()=>{if(alive.current&&version===generation.current)setElapsed(Math.min(MAX_LECTURE_SECONDS,Math.floor((Date.now()-began)/1000)));},500);
   timer.current=setTimeout(()=>{if(version===generation.current&&recorder.current===rec)rec.stop();},MAX_LECTURE_SECONDS*1000);
  }catch{if(version===generation.current)release();if(alive.current&&version===generation.current)setError('Could not start the microphone. Allow access or upload an audio file.');}
  finally{if(version===generation.current){opening.current=false;if(alive.current)setStarting(false);}}
 };
 useEffect(()=>{alive.current=true;setRecording(false);setStarting(false);setElapsed(0);setError('');return()=>{alive.current=false;++generation.current;opening.current=false;stop();release();};},[identity]);
 return {recording,starting,elapsed,error,start,stop};
}
