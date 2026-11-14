/** DEMO ONLY. Sample keys are inspectable in this lazy module, never part of publicSpec.
 * Replace this adapter with server verification in G5; never put real lecture keys here. */
import {lostBinaryKingdom} from './lost-binary-kingdom';
import {parsePuzzleAnswer,invalidAnswer} from '../mechanics/types';
import {validateGate} from '../mechanics/gate';
import {validateSequence} from '../mechanics/sequence';
import {validateMatch} from '../mechanics/match';
export async function verifyLocalSample(missionId:string,input:unknown){
 const mission=lostBinaryKingdom.missions.find(m=>m.id===missionId);if(!mission)return invalidAnswer();const answer=parsePuzzleAnswer(mission.puzzle,input);if(!answer)return invalidAnswer();
 if(missionId==='power-path'&&answer.type==='sequence')return validateSequence(answer.order,[1,3,2,0],mission.puzzle.difficulty);
 if(missionId==='east-gate'&&answer.type==='gate'&&mission.puzzle.type==='gate')return validateGate(mission.puzzle,answer.value,{kind:'text',value:'1101'});
 if(missionId==='circuit-archive'&&answer.type==='match')return validateMatch(answer.pairs,[[0,1],[1,2],[2,0]],mission.puzzle.difficulty);
 return invalidAnswer();
}
