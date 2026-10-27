import {isSpaceId,spaceText,spaceCode,remixCredit,type RemixCredit,type SpaceCode,type SpaceSnapshot} from './space';
export type GalleryCredit=RemixCredit;
export type GalleryPage=SpaceCode & {id:string;title:string;description:string;author:string;parentId:string|null;credit?:GalleryCredit|null;createdAt:string;updatedAt:string;published?:boolean;moderation?:string;reportCount?:number};
export type GalleryNode={id:string;parentId:string|null;title:string;author:string;depth:number};
export function galleryText(value:unknown,max:number,label:string,empty=false){
 const text=spaceText(value,max,label,empty).trim();
 const normalized=text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').toLowerCase();
 if(/[<>\u0000-\u0008\u000B-\u001F\u007F]/.test(text)||/(^|[^\p{L}\p{N}])(fuck(?:ing|er|s)?|shit|bitch|nigger|faggot)(?=$|[^\p{L}\p{N}])/u.test(normalized))throw new Error(`Please use appropriate plain text for ${label}.`);
 return text;
}
export function galleryMetadata(value:any){return {title:galleryText(value?.title,80,'public title'),description:galleryText(value?.description,400,'description',true),author:galleryText(value?.author,40,'public author name')};}
export function galleryCredit(value:any):GalleryCredit|null {return remixCredit(value);}
export function galleryPage(value:any,code=false):GalleryPage{
 if(!isSpaceId(value?.id)||!Number.isFinite(Date.parse(value.created_at??value.createdAt))||!Number.isFinite(Date.parse(value.updated_at??value.updatedAt)))throw new Error('Invalid gallery page.');
 const parentId=value.parent_id??value.parentId??null;if(parentId!==null&&!isSpaceId(parentId))throw new Error('Invalid remix parent.');
 return {...(code?spaceCode(value):{html:'',css:'',js:''}),id:value.id,title:spaceText(value.title,80,'public title'),description:spaceText(value.description??'',400,'description',true),author:spaceText(value.author,40,'author'),parentId,credit:galleryCredit(value.remix_credit??value.credit),createdAt:value.created_at??value.createdAt,updatedAt:value.updated_at??value.updatedAt,
  ...(typeof value.published==='boolean'?{published:value.published,moderation:String(value.moderation),reportCount:Number(value.report_count??0)}:{})};
}
export function gallerySnapshot(page:GalleryPage):SpaceSnapshot{
 return {page:{id:page.id,slug:'gallery-'+page.id.slice(0,12),title:page.title,currentVersionId:page.id,permissions:{tasks:false,events:false},createdAt:page.createdAt,updatedAt:page.updatedAt},version:{...spaceCode(page),id:page.id,pageId:page.id,kind:'initial',prompt:'',reply:'',model:'',restoredFrom:null,createdAt:page.createdAt}};
}
