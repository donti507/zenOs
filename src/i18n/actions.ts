import {tr} from './index';
/** Translate app-generated action templates; captured authored titles remain literal. */
export function localizedAction(label:string){
 const patterns:[RegExp,string][]=[
  [/^Create task “([\s\S]*)”$/,'Create task “{{0}}”'],
  [/^Complete “([\s\S]*)”$/,'Complete “{{0}}”'],
  [/^Reopen “([\s\S]*)”$/,'Reopen “{{0}}”'],
  [/^Update “([\s\S]*)”$/,'Update “{{0}}”'],
  [/^Add (\d+) steps to “([\s\S]*)”$/,'Add {{0}} steps to “{{1}}”'],
  [/^Schedule “([\s\S]*)”$/,'Schedule “{{0}}”'],
  [/^Filter by ([\s\S]*)$/,'Filter by {{0}}'],
  [/^No single task matches “([\s\S]*)”$/,'No single task matches “{{0}}”'],
 ];
 for(const [pattern,key] of patterns){const match=label.match(pattern);if(match)return tr(key,...match.slice(1));}
 return tr(label);
}
