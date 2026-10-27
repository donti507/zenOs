import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();
const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002';
beforeAll(async()=>{
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${a}'),('${b}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`);
  await db.exec(readFileSync('supabase-schema.sql','utf8'));
  const migration=readFileSync('supabase-schema-update.sql','utf8');await db.exec(migration);await db.exec(migration);
  await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('test.uid',$1,false)",[a]);
},30000);
afterAll(()=>db.close());
const remember=(fact:unknown,owner=a)=>db.query<{fact:any}>('SELECT remember_dante_fact($1,$2) AS fact',[fact,owner]);
it('saves trimmed facts with IDs/timestamps and deduplicates replays',async()=>{
  const saved=(await remember('  I prefer mornings  ')).rows[0].fact;
  expect(saved).toMatchObject({user_id:a,fact:'I prefer mornings'});expect(saved.id).toBeTruthy();expect(saved.created_at).toBeTruthy();
  expect((await remember('I prefer mornings')).rows[0].fact.id).toBe(saved.id);
});
it('rejects invalid lengths including direct writes and accepts 200 Unicode characters',async()=>{
  for(const value of ['', '   ', null, 'x'.repeat(201)])await expect(remember(value)).rejects.toThrow('1-200');
  expect((await remember('🧠'.repeat(200))).rows[0].fact.fact).toBe('🧠'.repeat(200));
  await expect(db.query('INSERT INTO dante_memory(user_id,fact) VALUES($1,$2)',[a,'x'.repeat(201)])).rejects.toThrow();
});
it('caps concurrent/repeated inserts at 100, including direct table writes, while allowing duplicate RPC replays at capacity',async()=>{
  await Promise.all(Array.from({length:98},(_,i)=>remember(`Fact ${i}`)));
  expect((await db.query('SELECT id FROM dante_memory')).rows).toHaveLength(100);
  await expect(remember('101st fact')).rejects.toThrow('100 facts');
  await expect(db.query('INSERT INTO dante_memory(user_id,fact) VALUES($1,$2)',[a,'direct bypass'])).rejects.toThrow('100 facts');
  expect((await remember('I prefer mornings')).rows[0].fact.fact).toBe('I prefer mornings');
});
it('isolates owners, prevents owner-spoofed RPCs/updates, and reopens capacity after forgetting',async()=>{
  await expect(remember('spoof',b)).rejects.toThrow('Authentication required');
  await db.query("SELECT set_config('test.uid',$1,false)",[b]);
  expect((await db.query('SELECT * FROM dante_memory')).rows).toHaveLength(0);
  const saved=(await remember('Private B',b)).rows[0].fact;
  await expect(db.query('INSERT INTO dante_memory(user_id,fact) VALUES($1,$2)',[a,'foreign insert'])).rejects.toThrow();
  expect((await db.query('DELETE FROM dante_memory WHERE user_id=$1 RETURNING id',[a])).rows).toHaveLength(0);
  await expect(db.query("UPDATE dante_memory SET fact='tampered'")).rejects.toThrow('permission denied');
  await db.query("SELECT set_config('test.uid',$1,false)",[a]);
  expect((await db.query('DELETE FROM dante_memory WHERE id=$1 RETURNING id',[saved.id])).rows).toHaveLength(0);
  await db.exec('DELETE FROM dante_memory WHERE id=(SELECT id FROM dante_memory LIMIT 1)');
  await remember('Room after forget');expect((await db.query('SELECT id FROM dante_memory')).rows).toHaveLength(100);
});
it('denies anonymous memory access and cascades facts when the auth account is deleted',async()=>{
  await db.exec('RESET ROLE; SET ROLE anon');
  await expect(db.query('SELECT * FROM dante_memory')).rejects.toThrow('permission denied');
  await expect(remember('anonymous')).rejects.toThrow('permission denied');
  await db.exec(`RESET ROLE; DELETE FROM auth.users WHERE id='${a}'`);
  expect((await db.query('SELECT * FROM dante_memory WHERE user_id=$1',[a])).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM dante_memory WHERE user_id=$1',[b])).rows).toHaveLength(1);
});
