import {galleryText} from './gallery';
export const BADGES = {first_page:'First page',first_remix:'First remix',challenge_winner:'Challenge winner',seven_day_streak:'7-day streak'} as const;
export type BadgeKey=keyof typeof BADGES;
export type Badge={key:BadgeKey;earnedAt:string};
export type BuildChallenge={id:string;title:string;description:string;startsAt:string;endsAt:string;finalized:boolean};
export type ChallengeEntry={id:string;pageId:string;title:string;author:string;votes:number;winner:boolean};
export type ChallengeDetail={challenge:BuildChallenge;entries:ChallengeEntry[];myVote:string|null;myEntry:string|null};
export function challengeInput(value:any){
 const starts=Date.parse(value?.startsAt),ends=Date.parse(value?.endsAt);
 if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts||ends-starts>31*86400000)throw new Error('Choose a start and end date, at most 31 days apart.');
 return {title:galleryText(value?.title,80,'challenge title'),description:galleryText(value?.description,1000,'challenge description'),startsAt:new Date(starts).toISOString(),endsAt:new Date(ends).toISOString()};
}
