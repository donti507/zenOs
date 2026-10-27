import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const db=new PGlite();const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',round='10000000-0000-0000-0000-000000000001';
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const migration=readFileSync('supabase-schema-update.sql','utf8');await db.exec(migration);await db.exec(migration);
},30000);
afterAll(()=>db.close());
const consume=(amount=2)=>db.query<any>("SELECT * FROM consume_dante_usage_amount($1,'messages',20,$2)",[a,amount]);
it('reserves pairs atomically with ordinary messages and never partially charges a denied pair',async()=>{
 await db.exec('SET ROLE service_role');
 for(let i=0;i<17;i++)await db.query("SELECT * FROM consume_dante_usage($1,'messages',20)",[a]);
 const result=await Promise.all([consume(),consume()]);expect(result.map(row=>row.rows[0].allowed)).toEqual([true,false]);
 expect(result[1].rows[0].messages).toBe(19);
 expect((await consume(1)).rows[0]).toMatchObject({allowed:true,messages:20});
 expect((await consume()).rows[0]).toMatchObject({allowed:false,messages:20});
 await expect(consume(0)).rejects.toThrow('Invalid usage');await expect(consume(3)).rejects.toThrow('Invalid usage');
});
it('only lets the service create/complete rounds and denies votes on unfinished or foreign rounds',async()=>{
 await db.query("INSERT INTO space_arena_rounds(id,user_id,model_a,model_b) VALUES($1,$2,'alpha','beta')",[round,a]);
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${a}',false)`);
 expect((await db.query('SELECT * FROM space_arena_rounds')).rows).toHaveLength(1);
 await expect(db.query("SELECT vote_space_arena($1,'a')",[round])).rejects.toThrow('Completed comparison');
 await expect(db.query('UPDATE space_arena_rounds SET completed=true')).rejects.toThrow('permission denied');
 await expect(db.query('SELECT * FROM consume_dante_usage_amount($1,\'messages\',20,2)',[a])).rejects.toThrow('permission denied');
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${b}',false)`);
 expect((await db.query('SELECT * FROM space_arena_rounds')).rows).toHaveLength(0);
 await expect(db.query("SELECT vote_space_arena($1,'a')",[round])).rejects.toThrow('Completed comparison');
});
it('records one immutable vote per completed round, deduplicates retries and ranks only the signed-in user',async()=>{
 await db.exec('RESET ROLE;SET ROLE service_role');await db.query('UPDATE space_arena_rounds SET completed=true WHERE id=$1',[round]);
 await db.query("INSERT INTO space_arena_rounds(id,user_id,model_a,model_b,completed,winner) VALUES(gen_random_uuid(),$1,'alpha','beta',true,'b')",[b]);
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${a}',false)`);
 for(let i=0;i<2;i++)await db.query("SELECT vote_space_arena($1,'a')",[round]);
 await expect(db.query("SELECT vote_space_arena($1,'b')",[round])).rejects.toThrow('already recorded');
 await expect(db.query("SELECT vote_space_arena($1,'foreign-model')",[round])).rejects.toThrow('Invalid vote');
 const rows=(await db.query<any>('SELECT * FROM space_arena_leaderboard()')).rows;
 expect(rows.map(row=>[row.model,Number(row.wins),Number(row.comparisons)])).toEqual([['alpha',1,1],['beta',0,1]]);
});
it('denies anonymous reads/votes and cascades all Arena data on account deletion',async()=>{
 await db.exec('RESET ROLE;SET ROLE anon');await expect(db.query('SELECT * FROM space_arena_rounds')).rejects.toThrow('permission denied');
 await expect(db.query('SELECT * FROM space_arena_leaderboard()')).rejects.toThrow('permission denied');await expect(db.query("SELECT vote_space_arena($1,'a')",[round])).rejects.toThrow('permission denied');
 await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[a]);expect((await db.query('SELECT * FROM space_arena_rounds WHERE user_id=$1',[a])).rows).toHaveLength(0);
});
