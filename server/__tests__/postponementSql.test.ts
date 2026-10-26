import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();const user='00000000-0000-0000-0000-000000000001';
const migration=readFileSync('supabase-schema-update.sql','utf8');
let id:string;
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 INSERT INTO auth.users VALUES ('${user}');`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));await db.exec(migration);
 await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON tasks,categories,meetings,vault_items TO authenticated;
 SET ROLE authenticated; SELECT set_config('test.uid','${user}',false)`);
 id=(await db.query<{id:string}>("INSERT INTO tasks(user_id,title,date,recurrence) VALUES ($1,'Report','2026-10-27','daily') RETURNING id",[user])).rows[0].id;
},30000);
afterAll(()=>db.close());
const count=async()=> (await db.query<{postponed_count:number}>('SELECT postponed_count FROM tasks WHERE id=$1',[id])).rows[0].postponed_count;
const move=(date:string|null)=>db.query('UPDATE tasks SET date=$1 WHERE id=$2',[date,id]);
it('counts actual later transitions atomically and ignores duplicate/stale edits',async()=>{
 await Promise.all([move('2026-10-28'),move('2026-10-28')]);expect(await count()).toBe(1);
 await move('2026-10-29');await move('2026-10-30');expect(await count()).toBe(3);
 await db.query('UPDATE tasks SET postponed_count=0,note=$1 WHERE id=$2',['Changed',id]);expect(await count()).toBe(3);
});
it('does not count earlier, unchanged, cleared, initial or invalid dates',async()=>{
 await move('2026-10-29');await move('2026-10-29');await move(null);await move('2026-10-31');
 await move('2026-02-31');await move('2026-11-01');expect(await count()).toBe(3);
});
it('preserves counts on migration reruns and gives a new recurring occurrence a fresh count',async()=>{
 await db.exec('RESET ROLE');await db.exec(migration);expect(await count()).toBe(3);
 await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid','${user}',false)`);
 await db.query("UPDATE tasks SET status='done' WHERE id=$1",[id]);
 const next=(await db.query<{postponed_count:number}>('SELECT postponed_count FROM tasks WHERE recurrence_source_id=$1',[id])).rows;
 expect(next).toHaveLength(1);expect(next[0].postponed_count).toBe(0);
});
it('preserves imported local postpone history without counting the import itself',async()=>{
 const payload={categories:[],meetings:[],vault:[],tasks:[{id:'local',title:'Imported',date:'2026-11-01',status:'todo',postponedCount:4}]};
 await db.query('SELECT import_local_data($1::jsonb,$2::uuid)',[JSON.stringify(payload),'10000000-0000-0000-0000-000000000008']);
 expect((await db.query<{postponed_count:number}>("SELECT postponed_count FROM tasks WHERE title='Imported'")).rows[0].postponed_count).toBe(4);
});
