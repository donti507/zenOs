import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();const user='00000000-0000-0000-0000-000000000001';const other='00000000-0000-0000-0000-000000000002';
const migration=readFileSync('supabase-schema-update.sql','utf8');
const draft={id:'plan-one',name:'Physics',examDate:'2099-11-10',minutesPerDay:50};
const sessions=[{topic:'Atoms',topicId:'atoms',date:'2099-11-08',minutes:25},{topic:'Energy',topicId:'energy',date:'2099-11-09',minutes:25}];
const save=(d=draft,s=sessions,expected:unknown=null,owner=user)=>db.query<{result:any}>('SELECT save_exam_plan($1,$2::jsonb,$3::jsonb,$4::jsonb) AS result',[owner,JSON.stringify(d),JSON.stringify(s),expected===null?null:JSON.stringify(expected)]);
const snapshot=async()=> (await db.query<any>(`SELECT id::text,date,status,steps,exam_plan FROM tasks WHERE exam_plan->>'id'='plan-one' AND status <> 'done' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(steps) s WHERE s->>'id'=exam_plan->>'topicId' AND s->>'done'='true') ORDER BY id::text`)).rows;
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 INSERT INTO auth.users VALUES ('${user}'),('${other}');`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));await db.exec(migration);await db.exec(migration);
 await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON tasks,categories,meetings,vault_items TO authenticated;
 SET ROLE authenticated; SELECT set_config('test.uid','${user}',false)`);
},30000);
afterAll(()=>db.close());
it('creates a category and sessions atomically, retrying without duplicates',async()=>{
 const result=(await save()).rows[0].result;expect(result.tasks).toHaveLength(2);expect(result.category.label).toBe('Exams');
 expect((await save()).rows[0].result.tasks).toHaveLength(2);
 expect((await db.query('SELECT * FROM categories')).rows).toHaveLength(1);
});
it('rolls back invalid sessions and enforces daily capacity',async()=>{
 await expect(save({...draft,id:'bad'},[sessions[0],{...sessions[1],date:'2099-11-10'}])).rejects.toThrow();
 expect((await db.query("SELECT * FROM tasks WHERE exam_plan->>'id'='bad'")).rows).toHaveLength(0);
 await expect(save({...draft,id:'capacity',minutesPerDay:25},sessions.map(s=>({...s,date:'2099-11-09'})))).rejects.toThrow('capacity');
});
it('preserves checked steps, IDs and notes while re-planning remaining tasks; rejects stale snapshots',async()=>{
 await db.query("UPDATE tasks SET steps=jsonb_set(steps,'{0,done}','true'), note='Keep notes' WHERE exam_plan->>'topicId'='atoms'");
 const expected=await snapshot();expect(expected).toHaveLength(1);
 const updated=(await save(draft,[{...sessions[1],date:'2099-11-08'}],expected)).rows[0].result.tasks;
 expect(updated.find((t:any)=>t.exam_plan.topicId==='energy').id).toBe(expected[0].id);
 const atoms=updated.find((t:any)=>t.exam_plan.topicId==='atoms');expect(atoms.steps[0].done).toBe(true);expect(atoms.note).toBe('Keep notes');
 await expect(save(draft,[sessions[1]],expected)).rejects.toThrow('Plan changed');
});
it('rejects a switched account and isolates plans under RLS',async()=>{
 await expect(save(draft,sessions,null,other)).rejects.toThrow('Account changed');
 await db.exec(`SELECT set_config('test.uid','${other}',false)`);
 expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(0);
 expect((await save(draft,sessions,null,other)).rows[0].result.tasks).toHaveLength(2);
});
it('preserves imported plan metadata and topic step identities',async()=>{
 const examPlan={...draft,topicId:'imported-topic'};
 const payload={categories:[],meetings:[],vault:[],tasks:[{id:'local-exam',title:'Imported exam',status:'todo',date:'2099-11-08',steps:[{id:'imported-topic',label:'Topic',done:true}],examPlan}]};
 await db.query('SELECT import_local_data($1::jsonb,$2::uuid)',[JSON.stringify(payload),'10000000-0000-0000-0000-000000000099']);
 const task=(await db.query<any>("SELECT * FROM tasks WHERE title='Imported exam'")).rows[0];
 expect(task.exam_plan).toEqual(examPlan);expect(task.steps[0]).toEqual({id:'imported-topic',label:'Topic',done:true});
});
