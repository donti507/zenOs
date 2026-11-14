import {it,expect} from 'vitest';
import {validateGate,parseGateNumber,normalizeGateText} from '../mechanics/gate';
import {validateSequence,activateSwitch} from '../mechanics/sequence';
import {validateMatch,moveCarrier,nearStation,placePair,deliveryRoute} from '../mechanics/match';
import {parsePuzzleAnswer,maxHintLevel,emptyPuzzleStats,type GatePuzzle} from '../mechanics/types';
import {lostBinaryKingdom as sample} from '../samples/lost-binary-kingdom';
import {validateAdventureSpec} from '../spec';
import {verifyLocalSample} from '../samples/local-verifier';
const base=sample.missions[1].puzzle as GatePuzzle;
it('checks finite numeric answers with exact or absolute-tolerance semantics and rounding at the boundary',()=>{
 const p:GatePuzzle={...base,input:'number'};expect(validateGate(p,'3.14',{kind:'number',value:3.14}).correct).toBe(true);expect(validateGate(p,'3,14',{kind:'number',value:3.14}).correct).toBe(true);expect(validateGate(p,'1e2',{kind:'number',value:100}).correct).toBe(true);expect(validateGate(p,1.1,{kind:'number',value:1,tolerance:.1}).correct).toBe(true);expect(validateGate(p,1.1001,{kind:'number',value:1,tolerance:.1}).correct).toBe(false);expect(validateGate(p,1.0000001,{kind:'number',value:1}).correct).toBe(false);
 for(const v of ['', ' ', 'Infinity','NaN','0x10','1,2,3',true,null,{},'1e1000'])expect(parseGateNumber(v)).toBe(null);for(const tolerance of [-1,Infinity,NaN])expect(()=>validateGate(p,1,{kind:'number',value:1,tolerance})).toThrow('Invalid verifier key');
});
it('normalizes text case, whitespace, accents and Polish letters without evaluating markup',()=>{
 expect(normalizeGateText('  ŁÓDŹ\t  jest  ')).toBe('lodz jest');expect(validateGate(base,'  ŁÓDŹ\nJEST ',{kind:'text',value:'lodz jest'}).correct).toBe(true);expect(validateGate(base,'Answer',{kind:'text',value:'answer',normalize:false}).correct).toBe(false);expect(validateGate(base,'<script>x</script>',{kind:'text',value:'safe'}).correct).toBe(false);expect(validateGate(base,'x'.repeat(201),{kind:'text',value:'x'}).code).toBe('invalid');expect(()=>validateGate(base,'x',{kind:'text',value:''})).toThrow();
});
it('checks choice indices without string coercion or client-controlled answer keys',()=>{
 const p:GatePuzzle={...base,input:'choice',choices:['A','B','C']};expect(validateGate(p,1,{kind:'choice',index:1}).correct).toBe(true);for(const value of ['1',-1,1.5,3,NaN])expect(validateGate(p,value,{kind:'choice',index:1}).code).toBe('invalid');expect(()=>validateGate(p,1,{kind:'choice',index:3})).toThrow();
});
it('checks complete sequences, rejects repeated switches and controls feedback detail by difficulty',()=>{
 expect(validateSequence([1,3,2,0],[1,3,2,0]).correct).toBe(true);expect(validateSequence([0,1,2,3],[1,3,2,0],1).firstError).toBe(0);expect(validateSequence([0,1,2,3],[1,3,2,0],3).firstError).toBeUndefined();for(const value of [[1,1,2,0],[1,3],['1',3,2,0],[-1,3,2,0]])expect(validateSequence(value,[1,3,2,0]).code).toBe('invalid');expect(activateSwitch([1],1,4)).toEqual([1]);expect(activateSwitch([1],3,4)).toEqual([1,3]);expect(()=>validateSequence([0,1,2],[0,0,2])).toThrow();
});
it('checks one-to-one matches independent of pair order, rejects reuse and suppresses challenge clues',()=>{
 const key:[[number,number],[number,number],[number,number]]=[[0,1],[1,2],[2,0]];expect(validateMatch([[2,0],[0,1],[1,2]],key).correct).toBe(true);expect(validateMatch([[0,1],[1,0],[2,2]],key,1).matched).toBe(1);expect(validateMatch([[0,1],[1,0],[2,2]],key,3).matched).toBeUndefined();for(const answer of [[[0,1],[0,2],[2,0]],[[0,1],[1,1],[2,0]],[[0,1]],[[0,1,2],[1,2],[2,0]]])expect(validateMatch(answer,key).code).toBe('invalid');
});
it('keeps carried-item movement bounded and supports adjacent pickup/delivery without teleport pairing',()=>{
 expect(moveCarrier({x:0,y:0},-1,-1,3)).toEqual({x:0,y:0});expect(moveCarrier({x:6,y:6},1,1,3)).toEqual({x:6,y:6});const route=deliveryRoute({x:1,y:1},{x:5,y:3});expect(route).toHaveLength(6);expect(route[route.length-1]).toEqual({x:5,y:3});expect(nearStation({x:1,y:1},0,0)).toBe(true);expect(nearStation({x:3,y:1},0,0)).toBe(false);expect(placePair([],0,1,3)).toEqual([[0,1]]);expect(placePair([[0,1]],2,1,3)).toEqual([[0,1]]);expect(placePair([],null,1,3)).toEqual([]);
});
it('accepts only bounded public attempt shapes and gates hints by wrong attempts',()=>{
 expect(parsePuzzleAnswer(sample.missions[0].puzzle,{type:'sequence',order:[1,3,2,0],correct:true})).toBe(null);expect(parsePuzzleAnswer(sample.missions[0].puzzle,Object.assign(Object.create({type:'sequence'}),{order:[1,3,2,0],extra:true}))).toBe(null);expect(parsePuzzleAnswer(sample.missions[0].puzzle,{type:'sequence',order:[1,1,1,1]})).toBe(null);const answer:any={type:'sequence',order:[1,3,2,0]},copy=parsePuzzleAnswer(sample.missions[0].puzzle,answer);answer.order[0]=0;expect(copy).toEqual({type:'sequence',order:[1,3,2,0]});expect(maxHintLevel(emptyPuzzleStats())).toBe(1);expect(maxHintLevel({attempts:1,wrongAttempts:1,hintLevel:1})).toBe(2);expect(maxHintLevel({attempts:99,wrongAttempts:99,hintLevel:2})).toBe(3);
});
it('keeps answers and verifier keys out of strict public specs for every mechanic',()=>{
 const serialized=JSON.stringify(sample);expect(serialized).not.toContain('1101');for(const index of [0,1,2])for(const field of ['answers','correctAnswer','solution','order','pairs','choiceIndex','tolerance']){const s:any=structuredClone(sample);s.missions[index].puzzle[field]=[1,3,2,0];expect(()=>validateAdventureSpec(s)).toThrow();}
 const duplicate:any=structuredClone(sample);duplicate.missions[0].puzzle.items=['A','A','B'];expect(()=>validateAdventureSpec(duplicate)).toThrow();
});
it('limits the fake verifier to the hand-written fixture and returns feedback without answer keys',async()=>{
 const correct=await verifyLocalSample('east-gate',{type:'gate',value:'1101'});expect(correct.correct).toBe(true);expect(await verifyLocalSample('other',{type:'gate',value:'1101'})).toEqual({correct:false,code:'invalid'});expect(await verifyLocalSample('power-path',{type:'sequence',order:[0,1,2,3]})).toMatchObject({correct:false,code:'incorrect',firstError:0});expect(JSON.stringify(correct)).not.toContain('1101');
});
