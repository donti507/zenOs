/** One bounded sentence ahead: providers stream bytes, playback never waits for the whole answer. */
const MAX_SECTION=600,MAX_AUDIO=4*1024*1024;
type Options={server:boolean;getToken:()=>Promise<string|null>;isCurrent:()=>boolean;lang:string;rate:number;voice:()=>SpeechSynthesisVoice|null;onStart:()=>void;onFallback:(message:string)=>void;request?:typeof fetch};
type Prepared={text:string;blob?:Blob};
export function speechSections(text:string){
 const sections:string[]=[];const split=(value:string)=>{let rest=value.trim();while(rest.length>MAX_SECTION){let end=rest.lastIndexOf(' ',MAX_SECTION);if(end<MAX_SECTION/2)end=MAX_SECTION;if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;sections.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();}if(rest)sections.push(rest);};
 let start=0;for(const match of text.matchAll(/[.!?…]["')\]]*(?:\s+|$)/g)){const end=match.index!+match[0].length;split(text.slice(start,end));start=end;}split(text.slice(start));return sections;
}

export function createLiveSpeech(options:Options){
 const abort=new AbortController(),queue:string[]=[];let stopped=false,server=options.server,working=false,playing=false,finished=false,lookahead:Promise<Prepared>|null=null;
 let resolveDone:()=>void=()=>{};const done=new Promise<void>(resolve=>{resolveDone=resolve;});let releasePlayback:(()=>void)|null=null;
 const current=()=>!stopped&&options.isCurrent();
 const fallback=(message='Server voice unavailable; using your browser voice.')=>{if(current()&&server){server=false;options.onFallback(typeof SpeechSynthesisUtterance!=='undefined'&&'speechSynthesis' in window?message:'Voice audio is unavailable. You can read the reply below.');}};
 const prepare=async(text:string):Promise<Prepared>=>{
  if(!server||!current())return {text};
  try{
   const token=await options.getToken();if(!current())return {text};if(!token)throw new Error('No session');
   const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(65000)]);
   const response=await (options.request||fetch)('/api/tts',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({text}),signal,cache:'no-store'});
   if(!response.ok){await response.body?.cancel().catch(()=>{});fallback(response.status===429?'Server speech limit reached; using your browser voice.':undefined);return {text};}
   if(!response.body||!/^audio\//i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});throw new Error('Invalid audio');}
   const reader=response.body.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_AUDIO)throw new Error('Audio too large');chunks.push(new Uint8Array(part.value));}}finally{await reader.cancel().catch(()=>{});}
   if(!size)throw new Error('Empty audio');if(!current()||!server)return {text};return {text,blob:new Blob(chunks,{type:'audio/mpeg'})};
  }catch{if(current()&&!abort.signal.aborted)fallback();return {text};}
 };
 const browserSpeak=(text:string)=>new Promise<void>(resolve=>{
  if(!current()){resolve();return;}if(typeof SpeechSynthesisUtterance==='undefined'||!('speechSynthesis' in window)){options.onFallback('Voice audio is unavailable. You can read the reply below.');resolve();return;}
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang=options.lang;utterance.rate=options.rate;const voice=options.voice();if(voice)utterance.voice=voice;
  let settled=false;const finish=()=>{if(settled)return;settled=true;if(releasePlayback===cancel)releasePlayback=null;resolve();};const cancel=()=>{window.speechSynthesis.cancel();finish();};releasePlayback=cancel;
  utterance.onstart=()=>{if(current())options.onStart();};utterance.onend=utterance.onerror=finish;
  try{window.speechSynthesis.speak(utterance);}catch{finish();}
 });
 const audioSpeak=(blob:Blob)=>new Promise<boolean>(resolve=>{
  if(!current()){resolve(false);return;}let url:string|undefined,audio:HTMLAudioElement|undefined,settled=false;
  const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(releasePlayback===cancel)releasePlayback=null;if(audio){audio.onended=audio.onerror=audio.onplaying=null;audio.pause();audio.removeAttribute('src');audio.load();}if(url)URL.revokeObjectURL(url);resolve(ok);};
  const cancel=()=>finish(false);const timer=setTimeout(()=>finish(false),120000);releasePlayback=cancel;
  try{url=URL.createObjectURL(blob);audio=new Audio(url);audio.playbackRate=options.rate;audio.onplaying=()=>{if(current())options.onStart();};audio.onended=()=>finish(true);audio.onerror=()=>finish(false);void audio.play().catch(()=>finish(false));}catch{finish(false);}
 });
 const check=()=>{if(stopped||(finished&&!working&&!lookahead&&!queue.length))resolveDone();};
 const prefetch=()=>{if(current()&&playing&&!lookahead&&queue.length)lookahead=prepare(queue.shift()!);};
 const drain=async()=>{
  if(working||!current())return;working=true;
  try{while(current()&&(lookahead||queue.length)){
   const pending=lookahead||prepare(queue.shift()!);lookahead=null;const prepared=await pending;if(!current())break;
   playing=true;prefetch();
   if(prepared.blob&&server){const played=await audioSpeak(prepared.blob);if(!played&&current()){fallback();await browserSpeak(prepared.text);}}
   else await browserSpeak(prepared.text);
   playing=false;
  }}finally{working=false;playing=false;check();}
 };
 const speak=(text:string)=>{if(finished||!current())return;queue.push(...speechSections(text));if(playing)prefetch();void drain();};
 const stop=()=>{if(stopped)return;stopped=true;abort.abort();queue.length=0;lookahead=null;releasePlayback?.();releasePlayback=null;resolveDone();};
 return {speak,done,finish:()=>{finished=true;check();},stop,isCurrent:current};
}
