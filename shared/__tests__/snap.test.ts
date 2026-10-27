import { expect,it } from 'vitest';
import { parseSnapItems, snapItemError } from '../snap';
it('accepts only known item types, trims titles, and rejects invalid or excessive results',()=>{
 expect(parseSnapItems({items:[{title:' Exam ',date:'2028-02-29',type:'exam',action:'ignored'}]})).toEqual([{title:'Exam',date:'2028-02-29',type:'exam'}]);
 expect(parseSnapItems({items:[{title:'Task',date:'2027-02-29',type:'task'}]})[0].date).toBe('');
 expect(()=>parseSnapItems({items:Array(51).fill({title:'Task',date:'',type:'task'})})).toThrow();
 for(const item of [{title:'',type:'task'},{title:'Task',type:'unknown'},{title:'x'.repeat(201),type:'task'}])expect(()=>parseSnapItems({items:[item]})).toThrow();
 expect(snapItemError({title:'Task',type:'task',date:''})).toContain('valid date');
});
