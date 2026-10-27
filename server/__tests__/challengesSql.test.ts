import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const db=new PGlite();const [a,b,c,d]=Array.from({length:4},()=>randomUUID());let pa:string,pb:string;
const rpc=async(name:string,args:any[]=[]) => (await db.query<any>(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0]?.result;
async function publication(owner:string,slug:string){const page=randomUUID(),version=randomUUID();await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${owner}',false)`);await rpc('create_space_page',[page,slug,slug,version]);await db.exec('RESET ROLE;SET ROLE service_role');return rpc('publish_space_gallery',[owner,page,version,slug,'Description','Author']);}
async function challenge(start="now()-interval '1 day'",end="now()+interval '6 days'"){return (await db.query<any>(`INSERT INTO space_challenges(user_id,title,description,starts_at,ends_at) VALUES($1,'Build','Make a timer',${start},${end}) RETURNING id`,[a])).rows[0].id;}
const badges=async(user:string)=>(await db.query<any>('SELECT * FROM refresh_space_badges($1)',[user])).rows;
const entry=(user:string,challengeId:string,page:string)=>rpc('submit_space_challenge',[user,challengeId,page]);
const vote=(user:string,challengeId:string,entryId:string)=>rpc('vote_space_challenge',[user,challengeId,entryId]);
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 for(const id of [a,b,c,d])await db.query('INSERT INTO auth.users VALUES($1)',[id]);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const sql=readFileSync('supabase-schema-update.sql','utf8');await db.exec(sql);await db.exec(sql);
 pa=await publication(a,'alice');pb=await publication(b,'bob');
},30000);
afterAll(()=>db.close());
it('accepts one owned visible publication during the window and deduplicates submission retries',async()=>{
 const id=await challenge();await expect(entry(b,id,pa)).rejects.toThrow('own visible');const e=await entry(a,id,pa);expect(await entry(a,id,pa)).toBe(e);
 const another=await publication(a,'second');await expect(entry(a,id,another)).rejects.toThrow('One submission');
 const future=await challenge("now()+interval '1 day'","now()+interval '8 days'");await expect(entry(b,future,pb)).rejects.toThrow('not open');
 await db.query("UPDATE space_gallery_pages SET moderation='hidden' WHERE id=$1",[pb]);await expect(entry(b,id,pb)).rejects.toThrow('own visible');await db.query("UPDATE space_gallery_pages SET moderation='visible' WHERE id=$1",[pb]);
});
it('allows one immutable vote across the whole challenge, no self-votes or cross-challenge entries',async()=>{
 const id=await challenge(),ea=await entry(a,id,pa),eb=await entry(b,id,pb);await expect(vote(a,id,ea)).rejects.toThrow('another author');
 expect(await vote(c,id,ea)).toBe(ea);expect(await vote(c,id,ea)).toBe(ea);await expect(vote(c,id,eb)).rejects.toThrow('already recorded');
 const other=await challenge();await expect(vote(d,other,ea)).rejects.toThrow('another author');
 const detail=await rpc('space_challenge_detail',[id,c]);expect(detail.myVote).toBe(ea);expect(detail.entries.find((e:any)=>e.id===ea).votes).toBe(1);expect(JSON.stringify(detail)).not.toContain(c);
 expect((await rpc('space_challenge_detail',[id,null])).myVote).toBeNull();
 await db.query("UPDATE space_challenges SET ends_at=now()-interval '1 second' WHERE id=$1",[id]);await expect(vote(d,id,eb)).rejects.toThrow('not open');
});
it('finalizes tied positive leaders once, excludes withdrawn entries and never invents a no-vote winner',async()=>{
 const tied=await challenge(),ea=await entry(a,tied,pa),eb=await entry(b,tied,pb);await vote(c,tied,ea);await vote(d,tied,eb);
 const empty=await challenge();await entry(a,empty,pa);
 const withdrawn=await challenge(),wa=await entry(a,withdrawn,pa),wb=await entry(b,withdrawn,pb);await vote(c,withdrawn,wb);await vote(d,withdrawn,wb);await vote(b,withdrawn,wa);
 await db.query('UPDATE space_gallery_pages SET published=false WHERE id=$1',[pb]);
 for(const id of [tied,empty,withdrawn])await db.query("UPDATE space_challenges SET ends_at=now()-interval '1 second' WHERE id=$1",[id]);
 await rpc('finalize_space_challenges');await rpc('finalize_space_challenges');
 expect((await rpc('space_challenge_detail',[tied,null])).entries).toMatchObject([{id:ea,winner:true}]);
 expect((await rpc('space_challenge_detail',[empty,null])).entries[0].winner).toBe(false);
 expect((await rpc('space_challenge_detail',[withdrawn,null])).entries[0]).toMatchObject({id:wa,winner:true});
 // Republish after finalization cannot retroactively make an excluded entry win.
 await db.query('UPDATE space_gallery_pages SET published=true WHERE id=$1',[pb]);
 expect((await rpc('space_challenge_detail',[withdrawn,null])).entries.find((e:any)=>e.id===wb).winner).toBe(false);
 const tie2=await challenge(),ta=await entry(a,tie2,pa),tb=await entry(b,tie2,pb);await vote(c,tie2,ta);await vote(d,tie2,tb);await db.query("UPDATE space_challenges SET ends_at=now()-interval '1 second' WHERE id=$1",[tie2]);await rpc('finalize_space_challenges');expect((await rpc('space_challenge_detail',[tie2,null])).entries.every((e:any)=>e.winner)).toBe(true);
 expect((await db.query("SELECT * FROM space_badges WHERE badge='challenge_winner' AND user_id IN ($1,$2)",[a,b])).rows).toHaveLength(2);
});
it('awards permanent creation/remix milestones and only seven distinct consecutive server-dated days',async()=>{
 expect((await badges(a)).map((r:any)=>r.badge)).toContain('first_page');
 const snapshot=await rpc('remix_space_gallery',[c,pa,randomUUID(),'copy','Copy',randomUUID()]);
 expect((await badges(c)).map((r:any)=>r.badge)).toEqual(expect.arrayContaining(['first_page','first_remix']));
 await db.query('DELETE FROM space_pages WHERE id=$1',[snapshot.page.id]);expect((await badges(c)).map((r:any)=>r.badge)).toContain('first_remix');
 for(let i=1;i<=6;i++)await db.query("INSERT INTO space_activity_days(user_id,day) VALUES($1,(now() AT TIME ZONE 'UTC')::date-$2::integer)",[c,i]);
 expect((await badges(c)).map((r:any)=>r.badge)).toContain('seven_day_streak');await badges(c);expect((await db.query('SELECT * FROM space_activity_days WHERE user_id=$1',[c])).rows).toHaveLength(7);
 for(const i of [1,2,3,5,6,7])await db.query("INSERT INTO space_activity_days(user_id,day) VALUES($1,(now() AT TIME ZONE 'UTC')::date-$2::integer)",[d,i]);expect((await badges(d)).some((r:any)=>r.badge==='seven_day_streak')).toBe(false);
});
it('denies client writes and service RPCs, isolates all own rows, and cascades account data',async()=>{
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${c}',false)`);
 for(const table of ['space_challenges','space_challenge_entries','space_challenge_votes','space_badges','space_activity_days']){
  expect((await db.query<any>('SELECT * FROM '+table)).rows.every(row=>row.user_id===c)).toBe(true);
  await expect(db.query('DELETE FROM '+table+' WHERE user_id=$1',[c])).rejects.toThrow('permission denied');
 }
 await expect(badges(a)).rejects.toThrow('permission denied');await expect(rpc('vote_space_challenge',[a,randomUUID(),randomUUID()])).rejects.toThrow('permission denied');
 await db.exec('RESET ROLE;SET ROLE anon');await expect(db.query('SELECT * FROM space_challenges')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 await db.query('DELETE FROM auth.users WHERE id=$1',[c]);for(const table of ['space_challenge_entries','space_challenge_votes','space_badges','space_activity_days'])expect((await db.query('SELECT * FROM '+table+' WHERE user_id=$1',[c])).rows).toHaveLength(0);await db.exec('SET ROLE service_role');
});
