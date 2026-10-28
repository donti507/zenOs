import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const db=new PGlite(),a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003';
let workspace:string,token:string,sharedTask:string;
const identify=async(id:string,role='authenticated')=>{await db.exec(`RESET ROLE;SET ROLE ${role}`);await db.query("SELECT set_config('test.uid',$1,false)",[id]);};
beforeAll(async()=>{await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA realtime;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);INSERT INTO auth.users VALUES('${a}','owner@example.com',now()),('${b}','friend@example.com',now()),('${c}','other@example.com',now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.topic',true) $$;
 CREATE TABLE realtime.messages(id bigserial PRIMARY KEY,topic text,extension text DEFAULT 'broadcast',payload jsonb,private boolean DEFAULT true);
 ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA public,auth,realtime TO anon,authenticated,service_role;
 GRANT SELECT,INSERT,UPDATE ON realtime.messages TO anon,authenticated;GRANT USAGE ON SEQUENCE realtime.messages_id_seq TO anon,authenticated;
 CREATE POLICY broad ON realtime.messages TO anon,authenticated USING(true) WITH CHECK(true);
 CREATE FUNCTION realtime.broadcast_changes(topic_name text,event_name text,operation text,table_name text,table_schema text,new record,old record,level text DEFAULT 'ROW') RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO realtime.messages(topic,payload) VALUES(topic_name,jsonb_build_object('record',new,'old_record',old));END;$$;
 CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages(topic,payload,private) VALUES($3,$1,$4);$$;`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const sql=readFileSync('supabase-schema-update.sql','utf8');await db.exec(sql);await db.exec(sql);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON tasks,categories,meetings,vault_items,dante_messages TO authenticated');
},30000);
afterAll(()=>db.close());
it('creates membership atomically; denies anonymous creation and direct role escalation',async()=>{
 await identify('', 'anon');await expect(db.query("SELECT create_workspace('Team')")).rejects.toThrow('permission denied');
 await identify(a);workspace=(await db.query<any>("SELECT (create_workspace('Team')).id")).rows[0].id;
 expect((await db.query<any>('SELECT * FROM workspace_members')).rows).toMatchObject([{workspace_id:workspace,user_id:a,role:'owner'}]);
 await expect(db.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,\'owner\')',[workspace,b])).rejects.toThrow('permission denied');
 await identify(b);expect((await db.query('SELECT * FROM workspaces')).rows).toHaveLength(0);await expect(db.query('SELECT invite_workspace_member($1,$2)',[workspace,'friend@example.com'])).rejects.toThrow('Owner required');
});
it('binds expiring single-use links to the canonical verified email and preserves owner role',async()=>{
 await identify(a);const invite=(await db.query<any>('SELECT invite_workspace_member($1,$2) AS data',[workspace,'FRIEND@example.com'])).rows[0].data;token=invite.token;
 expect(token).toHaveLength(64);expect((await db.query<any>('SELECT token_hash FROM workspace_invites')).rows[0].token_hash).not.toBe(token);
 await identify(c);await expect(db.query('SELECT accept_workspace_invite($1)',[token])).rejects.toThrow('email');
 await identify(b);expect((await db.query('SELECT * FROM workspace_invites')).rows).toHaveLength(0);
 await db.exec('RESET ROLE');await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[b]);await identify(b);await expect(db.query('SELECT accept_workspace_invite($1)',[token])).rejects.toThrow('verified');
 await db.exec('RESET ROLE');await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[b]);await identify(b);
 await db.query('SELECT accept_workspace_invite($1)',[token]);await db.query('SELECT accept_workspace_invite($1)',[token]);
 expect((await db.query<any>('SELECT role FROM workspace_members WHERE user_id=$1',[b])).rows).toEqual([{role:'member'}]);
});
it('shares all four tables only with members, keeps personal rows private, and locks creator/scope',async()=>{
 await identify(a);for(const [table,field] of [['tasks','title'],['categories','label'],['meetings','subject'],['vault_items','name']]){
  await db.query(`INSERT INTO ${table}(user_id,${field}) VALUES($1,'private')`,[a]);
  const row=(await db.query<any>(`INSERT INTO ${table}(user_id,workspace_id,${field}) VALUES($1,$2,'shared') RETURNING id`,[a,workspace])).rows[0];if(table==='tasks')sharedTask=row.id;
 }
 await identify(b);for(const [table,field] of [['tasks','title'],['categories','label'],['meetings','subject'],['vault_items','name']]){
  expect((await db.query<any>(`SELECT ${field} AS name FROM ${table}`)).rows).toEqual([{name:'shared'}]);
  await db.query(`UPDATE ${table} SET ${field}='edited' WHERE workspace_id=$1`,[workspace]);
 }
 await expect(db.query('UPDATE tasks SET workspace_id=NULL WHERE id=$1',[sharedTask])).rejects.toThrow('immutable');
 await expect(db.query('UPDATE tasks SET user_id=$1 WHERE id=$2',[b,sharedTask])).rejects.toThrow('immutable');
 await expect(db.query("INSERT INTO tasks(user_id,workspace_id,title) VALUES($1,$2,'spoof')",[a,workspace])).rejects.toThrow('row-level');
 await identify(c);for(const table of ['tasks','categories','meetings','vault_items'])expect((await db.query('SELECT * FROM '+table)).rows).toHaveLength(0);
 await expect(db.query("INSERT INTO tasks(user_id,workspace_id,title) VALUES($1,$2,'no')",[c,workspace])).rejects.toThrow('row-level');
});
it('keeps shared recurrences in scope even when another member completes the task',async()=>{
 await identify(a);await db.query("UPDATE tasks SET recurrence='daily',date='2026-10-28' WHERE id=$1",[sharedTask]);await identify(b);
 await db.query("UPDATE tasks SET status='done' WHERE id=$1",[sharedTask]);
 const next=(await db.query<any>('SELECT * FROM tasks WHERE recurrence_source_id=$1',[sharedTask])).rows;expect(next).toHaveLength(1);expect(next[0]).toMatchObject({workspace_id:workspace,user_id:b,date:'2026-10-29'});
 await db.query("UPDATE tasks SET status='todo' WHERE id=$1",[sharedTask]);await identify(a);await db.query("UPDATE tasks SET status='done' WHERE id=$1",[sharedTask]);expect((await db.query('SELECT * FROM tasks WHERE recurrence_source_id=$1',[sharedTask])).rows).toHaveLength(1);
});
it('saves/retries exam plans in the shared scope and keeps identical personal plans separate',async()=>{
 await identify(a);const dates=(await db.query<any>("SELECT current_date::text AS start,(current_date+2)::text AS session,(current_date+7)::text AS exam")).rows[0];
 const draft={id:'scoped-plan',name:'Exam',minutesPerDay:25,examDate:dates.exam},sessions=[{date:dates.session,topic:'Review',topicId:'topic',minutes:25}];
 const args=[a,draft,sessions,null,dates.start,workspace];let result=(await db.query<any>('SELECT save_workspace_exam_plan($1,$2,$3,$4,$5,$6) AS data',args)).rows[0].data;
 expect(result.tasks).toHaveLength(1);expect(result.tasks[0].workspace_id).toBe(workspace);expect(result.category.workspace_id).toBe(workspace);
 await identify(b);args[0]=b;result=(await db.query<any>('SELECT save_workspace_exam_plan($1,$2,$3,$4,$5,$6) AS data',args)).rows[0].data;expect(result.tasks).toHaveLength(1);
 await identify(a);args[0]=a;result=(await db.query<any>('SELECT save_exam_plan($1,$2,$3,$4,$5) AS data',args.slice(0,5))).rows[0].data;expect(result.tasks).toHaveLength(1);expect(result.tasks[0].workspace_id).toBeNull();
});
it('broadcasts only invalidations for shared rows; membership authorizes exact private topics and denies forged sends',async()=>{
 await identify(b);await db.query("SELECT set_config('test.topic',$1,false)",['zenos:shared:'+workspace]);const events=(await db.query<any>('SELECT * FROM realtime.messages')).rows;
 expect(events.length).toBeGreaterThan(0);expect(events.every(e=>e.topic==='zenos:shared:'+workspace&&JSON.stringify(e.payload)===JSON.stringify({workspace_id:workspace}))).toBe(true);
 await expect(db.query('INSERT INTO realtime.messages(topic,payload) VALUES($1,$2)',['zenos:shared:'+workspace,{spoof:true}])).rejects.toThrow('row-level');
 await identify(c);expect((await db.query('SELECT * FROM realtime.messages')).rows).toHaveLength(0);
});
it('revokes row access including creator-owned shared rows and prevents replay after removal',async()=>{
 await identify(a);await expect(db.query('SELECT remove_workspace_member($1,$2)',[workspace,a])).rejects.toThrow('Owner cannot leave');await db.query('SELECT remove_workspace_member($1,$2)',[workspace,b]);
 await identify(b);expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM workspace_members')).rows).toHaveLength(0);
 await expect(db.query('SELECT accept_workspace_invite($1)',[token])).rejects.toThrow();
 expect((await db.query('UPDATE tasks SET title=\'forbidden\' WHERE workspace_id=$1 RETURNING id',[workspace])).rows).toHaveLength(0);
});
it('keeps an accepted link single-use after its accepting account is deleted',async()=>{
 await identify(a);const invite=(await db.query<any>('SELECT invite_workspace_member($1,$2) AS data',[workspace,'other@example.com'])).rows[0].data;
 await identify(c);await db.query('SELECT accept_workspace_invite($1)',[invite.token]);await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[c]);await db.query("INSERT INTO auth.users VALUES($1,'other@example.com',now())",[c]);await identify(c);
 await expect(db.query('SELECT accept_workspace_invite($1)',[invite.token])).rejects.toThrow('already accepted');
});
it('rejects expired/revoked links and removes workspace rows atomically with the owning account',async()=>{
 await identify(a);let token=(await db.query<any>('SELECT invite_workspace_member($1,$2) AS data',[workspace,'friend@example.com'])).rows[0].data.token;
 await db.exec('RESET ROLE');await db.query("UPDATE workspace_invites SET expires_at=now()-interval '1 day' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[token]);await identify(b);await expect(db.query('SELECT accept_workspace_invite($1)',[token])).rejects.toThrow();
 await identify(a);const invite=(await db.query<any>('SELECT invite_workspace_member($1,$2) AS data',[workspace,'friend@example.com'])).rows[0].data;await db.query('SELECT revoke_workspace_invite($1)',[invite.id]);await identify(b);await expect(db.query('SELECT accept_workspace_invite($1)',[invite.token])).rejects.toThrow();
 await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[a]);for(const table of ['workspaces','workspace_members','workspace_invites'])expect((await db.query('SELECT * FROM '+table)).rows).toHaveLength(0);
});
