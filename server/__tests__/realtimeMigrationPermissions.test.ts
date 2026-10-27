import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
it('continues later migrations when managed Realtime policies require an unavailable owner, without installing publishers',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE app_migrator;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
 CREATE SCHEMA realtime; CREATE TABLE realtime.messages(topic text,extension text);
 ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;
 CREATE FUNCTION realtime.broadcast_changes(text,text,text,text,text,record,record,text DEFAULT 'ROW') RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;
 GRANT USAGE ON SCHEMA auth,realtime TO app_migrator;
 GRANT REFERENCES ON auth.users TO app_migrator;
 GRANT CREATE,USAGE ON SCHEMA public TO app_migrator;
 SET ROLE app_migrator;`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));
 const migration=readFileSync('supabase-schema-update.sql','utf8');await db.exec(migration);await db.exec(migration);
 expect((await db.query("SELECT to_regclass('public.lectures') AS name")).rows[0]).toEqual({name:'lectures'});
 expect((await db.query("SELECT to_regclass('public.dante_memory') AS name")).rows[0]).toEqual({name:'dante_memory'});
 expect((await db.query("SELECT * FROM pg_trigger WHERE tgname='zenos_workspace_broadcast'")).rows).toHaveLength(0);
 expect((await db.query("SELECT * FROM pg_policies WHERE schemaname='realtime'")).rows).toHaveLength(0);
 expect((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass")).rows[0]).toEqual({relrowsecurity:true});
 }finally{await db.close();}
},30000);
