import { expect,it } from 'vitest';
import {spaceLineDiff} from '../spaceDiff';
it('highlights insertions, deletions and replacements with correct old/new line numbers',()=>{
 expect(spaceLineDiff('a\nb\nc\nd','a\nnew\nb\nd').lines).toEqual([
 {kind:'same',text:'a',before:1,after:1},{kind:'added',text:'new',before:null,after:2},
 {kind:'same',text:'b',before:2,after:3},{kind:'removed',text:'c',before:3,after:null},{kind:'same',text:'d',before:4,after:4}]);
 expect(spaceLineDiff('same','same').lines).toEqual([]);
 expect(spaceLineDiff('','first').lines).toEqual([{kind:'added',text:'first',before:null,after:1}]);
 expect(spaceLineDiff('last','').lines).toEqual([{kind:'removed',text:'last',before:1,after:null}]);
 expect(spaceLineDiff('a\r\nb','a\nb').lines).toEqual([]);
});
it('omits distant unchanged context and bounds large comparison work',()=>{
 const before=Array.from({length:30},(_,i)=>String(i));const after=[...before];after[15]='changed';
 const diff=spaceLineDiff(before.join('\n'),after.join('\n'));
 expect(diff.lines).toHaveLength(6);expect(diff.lines[0].before).toBe(14);
 const large=spaceLineDiff('a\n'.repeat(1000),'b\n'.repeat(1000));
 expect(large.coarse).toBe(true);expect(large.lines.filter(line=>line.kind==='added')).toHaveLength(1000);
});
it('keeps repeated unchanged lines aligned inside a changed region',()=>{
 const diff=spaceLineDiff('old\n}\nsame\n}\nend','new\n}\nsame\n}\nfinish');
 expect(diff.lines.filter(line=>line.kind==='same').map(line=>line.text)).toEqual(['}','same','}']);
});
