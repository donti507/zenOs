import {useCallback,useState} from 'react';
import type {AdventureSpec} from '../game/spec';
export type AdventureSettings={lowPerformance:boolean;reducedMotion:boolean};
const KEY='zenos_adventure_settings_v1';
export const SAMPLE_ADVENTURES=[{id:'lost-binary-kingdom',title:'The Lost Binary Kingdom',description:'Explore a quiet kingdom built around binary numbers and logic.',missions:3}] as const;
export function useAdventures(){
 const [adventureSettings,setSettings]=useState<AdventureSettings>(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||'{}');return {lowPerformance:p?.lowPerformance===true,reducedMotion:p?.reducedMotion===true};}catch{return {lowPerformance:false,reducedMotion:false};}});
 const setAdventureSettings=useCallback((patch:Partial<AdventureSettings>)=>setSettings(previous=>{const next={lowPerformance:typeof patch.lowPerformance==='boolean'?patch.lowPerformance:previous.lowPerformance,reducedMotion:typeof patch.reducedMotion==='boolean'?patch.reducedMotion:previous.reducedMotion};try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Settings remain available without storage. */}return next;}),[]);
 const loadAdventure=useCallback(async(id:string):Promise<AdventureSpec>=>{if(id!=='lost-binary-kingdom')throw new Error('Adventure not found.');return (await import('../game/samples/lost-binary-kingdom')).lostBinaryKingdom;},[]);
 return {adventures:SAMPLE_ADVENTURES,adventureSettings,setAdventureSettings,loadAdventure};
}
