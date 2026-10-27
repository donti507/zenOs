import {useCallback,useEffect,useRef,useState} from 'react';
import {loadDanteVoiceLanguage,loadDanteVoicePreferences,pickDanteVoice} from '../lib/danteVoice';
import {splitSentences} from './useSpeechSynthesis';
/** Explicit playback only; shares Live's voice preferences without opening a microphone. */
export function useDantePlayback(scope:string){
 const supported=typeof window!=='undefined'&&'speechSynthesis' in window&&typeof SpeechSynthesisUtterance!=='undefined';
 const [speaking,setSpeaking]=useState(false),[error,setError]=useState('');const run=useRef(0),current=useRef<SpeechSynthesisUtterance|null>(null);
 const stop=useCallback(()=>{const owned=current.current!==null;++run.current;current.current=null;if(supported&&owned)window.speechSynthesis.cancel();setSpeaking(false);},[supported]);
 useEffect(()=>{stop();setError('');return()=>{const owned=current.current!==null;++run.current;current.current=null;if(supported&&owned)window.speechSynthesis.cancel();};},[scope,stop,supported]);
 const play=useCallback((text:string)=>{
  stop();setError('');if(!supported){setError('Voice playback is unavailable in this browser. You can still read your recap.');return;}window.speechSynthesis.cancel();const prefs=loadDanteVoicePreferences(),lang=loadDanteVoiceLanguage(),voice=pickDanteVoice(window.speechSynthesis.getVoices(),lang,prefs.voiceURI),sentences=splitSentences(text);const captured=run.current;if(!sentences.length)return;setSpeaking(true);
  const next=(index:number)=>{if(captured!==run.current)return;if(index>=sentences.length){current.current=null;setSpeaking(false);return;}const utterance=new SpeechSynthesisUtterance(sentences[index]);current.current=utterance;utterance.lang=lang;utterance.rate=prefs.rate;if(voice)utterance.voice=voice;utterance.onend=()=>next(index+1);utterance.onerror=event=>{if(captured!==run.current)return;current.current=null;setSpeaking(false);if(!['canceled','interrupted'].includes(event.error))setError('Voice playback could not finish. Try Play recap again.');};try{window.speechSynthesis.speak(utterance);}catch{current.current=null;setSpeaking(false);setError('Voice playback could not start. Try Play recap again.');}};
  next(0);
 },[supported,stop]);
 return {supported,speaking,error,play,stop};
}
