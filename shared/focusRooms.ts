import {isSpaceId,spaceText} from './space';
export const FOCUS_SECONDS=25*60,BREAK_SECONDS=5*60;
export type FocusRoom={id:string;title:string;isHost:boolean;startedAt:string|null;elapsedSeconds:number;revision:number;lastActiveAt:string};
export type FocusMember={id:string;name:string;streak:number;sessions:{id:string;expiresAt:string}[]};
export type FocusSnapshot={room:FocusRoom;members:FocusMember[];serverNow:string};
export type FocusSample=FocusSnapshot&{receivedAt:number;serverTime:number};
export function focusSnapshot(value:any):FocusSnapshot{
 const room=value?.room;
 if(!isSpaceId(room?.id)||typeof room.isHost!=='boolean'||!Number.isSafeInteger(room.revision)||room.revision<0||!Number.isFinite(room.elapsedSeconds)||room.elapsedSeconds<0||!Number.isFinite(Date.parse(room.lastActiveAt))||!Number.isFinite(Date.parse(value?.serverNow))||(room.startedAt!==null&&!Number.isFinite(Date.parse(room.startedAt)))||!Array.isArray(value.members)||value.members.length>50)throw new Error('Invalid focus room state.');
 return {room:{id:room.id,title:spaceText(room.title,80,'room title'),isHost:room.isHost,startedAt:room.startedAt,elapsedSeconds:room.elapsedSeconds,revision:room.revision,lastActiveAt:room.lastActiveAt},serverNow:value.serverNow,members:value.members.map((member:any)=>{
  if(!isSpaceId(member?.id)||!Number.isInteger(member.streak)||member.streak<0||member.streak>3650||!Array.isArray(member.sessions)||member.sessions.length>3)throw new Error('Invalid focus member.');
  return {id:member.id,name:spaceText(member.name,40,'display name'),streak:member.streak,sessions:member.sessions.map((session:any)=>{if(!isSpaceId(session?.id)||!Number.isFinite(Date.parse(session.expiresAt)))throw new Error('Invalid focus session.');return {id:session.id,expiresAt:session.expiresAt};})};})};
}
export const focusTopic=(id:string)=>{if(!isSpaceId(id))throw new Error('Invalid focus room ID.');return 'zenos:focus:'+id;};
/** Anchor to monotonic time, so a mis-set laptop clock cannot change the room timer. */
export function focusClock(sample:FocusSample,monotonicNow:number){
 const serverNow=sample.serverTime+Math.max(0,monotonicNow-sample.receivedAt);
 const elapsed=sample.room.elapsedSeconds+(sample.room.startedAt?Math.max(0,(serverNow-Date.parse(sample.room.startedAt))/1000):0);
 const cycle=FOCUS_SECONDS+BREAK_SECONDS,position=Math.floor(elapsed)%cycle;
 return {serverNow,phase:position<FOCUS_SECONDS?'focus':'break',remaining:(position<FOCUS_SECONDS?FOCUS_SECONDS:cycle)-position,round:Math.floor(elapsed/cycle)+1,running:sample.room.startedAt!==null};
}
export function focusPresenceIds(presence:Record<string,unknown[]>){
 const ids=new Set<string>();for(const metas of Object.values(presence))if(Array.isArray(metas))for(const meta of metas){const id=(meta as any)?.sessionId;if(isSpaceId(id))ids.add(id);}return ids;
}
export function focusOnlineMembers(sample:FocusSample,presence:Set<string>,monotonicNow:number){const now=focusClock(sample,monotonicNow).serverNow;return sample.members.filter(member=>member.sessions.some(session=>presence.has(session.id)&&Date.parse(session.expiresAt)>now));}
