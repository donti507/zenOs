import {speechLocale} from '../i18n';
export const DANTE_VOICE_PREFS_KEY='zenos_live_prefs';
export type DanteVoicePreferences={voiceURI:string;rate:number;bargeIn:boolean};
export function loadDanteVoicePreferences():DanteVoicePreferences{
 try{const value=JSON.parse(localStorage.getItem(DANTE_VOICE_PREFS_KEY)||'{}');return {voiceURI:typeof value.voiceURI==='string'?value.voiceURI:'',rate:typeof value.rate==='number'&&Number.isFinite(value.rate)&&value.rate>=0.5&&value.rate<=2?value.rate:1.05,bargeIn:value.bargeIn===true};}catch{return {voiceURI:'',rate:1.05,bargeIn:false};}
}
export function loadDanteVoiceLanguage(){try{const value=JSON.parse(localStorage.getItem('zenos_voice_lang')||JSON.stringify(speechLocale()));return typeof value==='string'&&['en-US','pl-PL','de-DE','es-ES','fr-FR','uk-UA'].includes(value)?value:speechLocale();}catch{return speechLocale();}}
export function pickDanteVoice(voices:SpeechSynthesisVoice[],lang:string,voiceURI:string){const matches=voices.filter(voice=>voice.lang.startsWith(lang.split('-')[0]));return matches.find(voice=>voice.voiceURI===voiceURI)||matches.find(voice=>/natural|neural|google|premium|enhanced/i.test(voice.name))||matches[0]||null;}
