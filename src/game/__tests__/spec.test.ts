import {describe,it,expect} from 'vitest';
import {validateAdventureSpec} from '../spec';
import {lostBinaryKingdom} from '../samples/lost-binary-kingdom';
const sample=()=>structuredClone(lostBinaryKingdom);
describe('adventure boundary',()=>{
 it('loads the hand-authored versioned sample and all three bounded mechanics without answer keys',()=>{expect(validateAdventureSpec(JSON.stringify(sample()))).toEqual(sample());expect(sample().missions.map(m=>m.puzzle.type)).toEqual(['sequence','gate','match']);expect(JSON.stringify(sample())).not.toContain('correctAnswer');});
 it('rejects unknown versions, malformed or oversized JSON and cyclic objects cleanly',()=>{for(const value of [{...sample(),specVersion:2},'{invalid',' '.repeat(65537),null])expect(()=>validateAdventureSpec(value)).toThrow();const cyclic:any={};cyclic.self=cyclic;expect(()=>validateAdventureSpec(cyclic)).toThrow();});
 it('rejects executable fields, URLs, answer keys, nested unknown fields, HTML and control characters',()=>{
  const mutations=[(s:any)=>s.script='alert(1)',(s:any)=>s.assetUrl='https://evil.test', (s:any)=>s.missions[0].answers=['secret'],(s:any)=>s.npcs[0].dialogue[0].onClick='evil()', (s:any)=>s.title='<img src=x onerror=alert(1)>',(s:any)=>s.npcs[0].name='bad\u0000name'];
  for(const mutate of mutations){const s=sample();mutate(s);expect(()=>validateAdventureSpec(s)).toThrow();}
 });
 it('rejects duplicate IDs, reserved IDs, dangling references and unsupported slots/templates',()=>{
  const mutations=[(s:any)=>s.npcs[0].id='player',(s:any)=>s.missions[1].id=s.missions[0].id,(s:any)=>s.objectives[0].conceptIds=['missing'],(s:any)=>s.missions[0].npcId='missing',(s:any)=>s.missions[0].objectiveId='missing',(s:any)=>s.missions[0].prerequisites=['missing'],(s:any)=>s.finale.missionIds=['missing'],(s:any)=>s.npcs[0].dialogue[0].speaker='missing',(s:any)=>s.npcs[0].slot='evil',(s:any)=>s.missions[1].unlocks.gateSlot='evil',(s:any)=>s.template='javascript:evil'];
  for(const mutate of mutations){const s=sample();mutate(s);expect(()=>validateAdventureSpec(s)).toThrow();}
 });
 it('rejects cycles, unsupported mission counts, absent sources and oversized content',()=>{
  for(const mutate of [(s:any)=>s.missions[0].prerequisites=['circuit-archive'],(s:any)=>s.missions.pop(),(s:any)=>s.missions[0].sources=[],(s:any)=>s.missions[0].sources[0].quote='x'.repeat(201),(s:any)=>s.missions[0].puzzle.hints=['one'],(s:any)=>s.missions[0].xp=999]){const s=sample();mutate(s);expect(()=>validateAdventureSpec(s)).toThrow();}
 });
 it('validates choice inputs and matching dimensions',()=>{const s:any=sample();s.missions[1].puzzle.input='choice';expect(()=>validateAdventureSpec(s)).toThrow();s.missions[1].puzzle.choices=['A','B'];expect(()=>validateAdventureSpec(s)).not.toThrow();s.missions[2].puzzle.right.pop();expect(()=>validateAdventureSpec(s)).toThrow();});
});
it('rejects quest layouts whose only unlocker is trapped behind its own gate',()=>{
 const s=sample();s.npcs[0].slot='observatory';expect(()=>validateAdventureSpec(s)).toThrow();
});
