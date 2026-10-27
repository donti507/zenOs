import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';let id:string;
const cards=Array.from({length:10},()=>({question:'What stores energy?',answer:'ATP',known:null}));
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${a}'),('${b}'); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$; GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const migration=readFileSync('supabase-schema-update.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON tasks,categories TO authenticated; SET ROLE authenticated');await db.query("SELECT set_config('test.uid',$1,false)",[a]);
 const result=await db.query<{id:string}>('INSERT INTO lectures(user_id,title,duration_seconds,transcript,summary,key_points,flashcards,action_items) VALUES($1,$2,601,$3,$4,$5,$6,$7) RETURNING id',[a,'Biology','ATP stores energy.','Energy summary',JSON.stringify(['ATP']),JSON.stringify(cards),JSON.stringify([{title:'Read chapter',task_id:null}])]);id=result.rows[0].id;
},30000);
afterAll(()=>db.close());
it('preserves independent card reviews and rejects bad indices',async()=>{
 await Promise.all([db.query('SELECT review_lecture_card($1,0,true)',[id]),db.query('SELECT review_lecture_card($1,1,false)',[id])]);
 const row=(await db.query<any>('SELECT * FROM lectures WHERE id=$1',[id])).rows[0];expect(row.flashcards[0].known).toBe(true);expect(row.flashcards[1].known).toBe(false);expect(row.flashcards[2].known).toBeNull();
 await expect(db.query('SELECT review_lecture_card($1,10,true)',[id])).rejects.toThrow('Invalid review');
});
it('atomically creates one task per action even for concurrent retries',async()=>{
 const results=await Promise.all(Array.from({length:3},()=>db.query<any>("SELECT add_lecture_task($1,0,(now() AT TIME ZONE 'UTC')::date) AS result",[id])));
 const ids=results.map(result=>result.rows[0].result.task.id);expect(new Set(ids).size).toBe(1);expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
 const result=results[0].rows[0].result;expect(result.lecture.action_items[0].task_id).toBe(ids[0]);expect(result.task.title).toBe('Read chapter');expect(result.task.user_id).toBe(a);
 await expect(db.query("SELECT add_lecture_task($1,0,'2000-01-01')",[id])).rejects.toThrow('Invalid lecture action');
});
it('enforces the duration and ten-card schema on direct writes',async()=>{
 await expect(db.query('UPDATE lectures SET duration_seconds=3601 WHERE id=$1',[id])).rejects.toThrow();
 await expect(db.query("UPDATE lectures SET flashcards='[]' WHERE id=$1",[id])).rejects.toThrow();
 await expect(db.query("UPDATE lectures SET action_items='[{\"title\":\"\"}]' WHERE id=$1",[id])).rejects.toThrow();
});
it('prevents foreign reads, writes and task/review RPCs; denies anonymous access; cascades account deletion',async()=>{
 await db.query("SELECT set_config('test.uid',$1,false)",[b]);expect((await db.query('SELECT * FROM lectures')).rows).toHaveLength(0);
 expect((await db.query("UPDATE lectures SET title='stolen' RETURNING id")).rows).toHaveLength(0);
 await expect(db.query('SELECT review_lecture_card($1,0,true)',[id])).rejects.toThrow('Lecture not found');
 await expect(db.query("SELECT add_lecture_task($1,0,(now() AT TIME ZONE 'UTC')::date)",[id])).rejects.toThrow('Lecture action not found');
 await expect(db.query("INSERT INTO lectures(user_id,title,duration_seconds,transcript,summary,key_points,flashcards) VALUES($1,'spoof',1,'t','s','[\"p\"]',$2)",[a,JSON.stringify(cards)])).rejects.toThrow();
 await db.exec('RESET ROLE; SET ROLE anon');await expect(db.query('SELECT * FROM lectures')).rejects.toThrow('permission denied');
 await db.exec(`RESET ROLE; DELETE FROM auth.users WHERE id='${a}'`);expect((await db.query('SELECT * FROM lectures')).rows).toHaveLength(0);
});
