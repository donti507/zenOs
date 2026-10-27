import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {latestDueSunday} from '../../src/lib/localWeeklyRecaps';
import {calendarDay,recapMonday,shiftRecapDay} from '../../shared/weeklyRecaps';
const db=new PGlite();const [a,b,c,d]=Array.from({length:4},()=>randomUUID());let sunday:string,monday:string;
const rpc=async(name:string,args:any[]=[]) => (await db.query<any>(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0]?.result;
const configure=(user:string,zone='UTC',enabled:boolean|null=null)=>rpc('configure_weekly_recaps',[user,zone,enabled]);
const generate=(user:string,automatic=false)=>rpc('generate_weekly_recap',[user,automatic]);
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);for(const id of [a,b,c,d])await db.query('INSERT INTO auth.users VALUES($1)',[id]);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const sql=readFileSync('supabase-schema-update.sql','utf8');await db.exec(sql);await db.exec(sql);
 sunday=latestDueSunday(new Date(),'UTC');monday=shiftRecapDay(sunday,-6);
 for(const [day,title] of [[monday,'One'],[shiftRecapDay(monday,1),'Two'],[shiftRecapDay(monday,1),'Three'],[shiftRecapDay(sunday,-1),'Saturday'],[sunday,'Sunday']])await db.query("INSERT INTO tasks(user_id,title,status,completed_at,note) VALUES($1,$2,'done',($3::date+time '12:00') AT TIME ZONE 'UTC','PRIVATE_NOTE')",[a,title,day]);
 for(const [date,title] of [[monday,'Open Monday'],[sunday,'Open Sunday'],['','Unscheduled'],[shiftRecapDay(monday,-1),'Older backlog']])await db.query("INSERT INTO tasks(user_id,title,status,date) VALUES($1,$2,'todo',$3)",[a,title,date]);
 await db.query("INSERT INTO tasks(user_id,title,status,completed_at) VALUES($1,'Other owner','done',($2::date+time '12:00') AT TIME ZONE 'UTC')",[b,monday]);await db.query("INSERT INTO tasks(user_id,title,status,completed_at) VALUES($1,'Future','done',now()+interval '3 days')",[a]);await db.exec('SET ROLE service_role');
},30000);
beforeEach(()=>db.exec('RESET ROLE;SET ROLE service_role'));
afterAll(()=>db.close());
it('registers a real timezone and schedules Sundays at 18:00 across DST without enabling a disabled preference again',async()=>{
 for(const zone of ['Europe/Warsaw','America/New_York','Pacific/Auckland']){const data=await configure(c,zone);const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(data.nextDueAt));expect(parts.find(p=>p.type==='weekday')?.value).toBe('Sunday');expect(parts.find(p=>p.type==='hour')?.value).toBe('18');}
 await configure(c,'UTC',false);expect((await configure(c)).enabled).toBe(false);await expect(configure(c,'Invalid/Zone')).rejects.toThrow('Invalid time zone');
});
it('generates canonical completed-week counts, earliest best-day ties, streak and scoped slipped tasks, with no notes or other owners',async()=>{
 await configure(a);await db.query("UPDATE weekly_recap_preferences SET next_due_at=($2::date+time '18:00') AT TIME ZONE 'UTC' WHERE user_id=$1",[a,sunday]);const row=await generate(a,true);
 const includeSunday=calendarDay(new Date(),'UTC')>sunday;expect(row).toMatchObject({week_start:monday,through_date:sunday,tasks_done:5,best_day:shiftRecapDay(monday,1),best_day_count:2,streak:2,slipped_count:includeSunday?2:1,kind:'scheduled'});expect(row.slipped_tasks.map((task:any)=>task.title)).toEqual(includeSunday?['Open Monday','Open Sunday']:['Open Monday']);expect(JSON.stringify(row)).not.toContain('PRIVATE_NOTE');expect(row).not.toHaveProperty('user_id');
 expect(await generate(a,true)).toBeNull();const pref=(await db.query<any>('SELECT * FROM weekly_recap_preferences WHERE user_id=$1',[a])).rows[0];expect(calendarDay(new Date(pref.next_due_at),'UTC')).toBe(shiftRecapDay(sunday,7));
});
it('updates an on-demand week in place and handles no-data recaps honestly',async()=>{
 await configure(d);const first=await generate(d);expect(first).toMatchObject({tasks_done:0,best_day:null,best_day_count:0,streak:0,slipped_count:0,kind:'manual'});expect(first.suggestion).toContain('ten-minute');const second=await generate(d);expect(second.id).toBe(first.id);expect((await db.query('SELECT * FROM weekly_recaps WHERE user_id=$1',[d])).rows).toHaveLength(1);
});
it('prunes to eight distinct weeks per user atomically and preserves another account history',async()=>{
 const current=recapMonday(calendarDay(new Date(),'UTC'));await db.exec('RESET ROLE');for(let i=1;i<=10;i++)await db.query("INSERT INTO weekly_recaps(user_id,week_start,through_date,time_zone,tasks_done,best_day_count,streak,slipped_count,slipped_tasks,suggestion,kind) VALUES($1,$2,$2,'UTC',0,0,0,0,'[]','Try a small task','manual') ON CONFLICT(user_id,week_start) DO NOTHING",[d,shiftRecapDay(current,-7*i)]);await db.exec('SET ROLE service_role');await generate(d);expect((await db.query('SELECT * FROM weekly_recaps WHERE user_id=$1',[d])).rows).toHaveLength(8);expect((await db.query('SELECT * FROM weekly_recaps WHERE user_id=$1',[a])).rows).toHaveLength(1);
});
it('processes due preferences safely in bounded batches, skips disabled users and does not duplicate processed weeks',async()=>{
 await configure(b);await db.query("UPDATE weekly_recap_preferences SET next_due_at=now()-interval '8 days' WHERE user_id IN($1,$2)",[b,c]);const first=await rpc('run_due_weekly_recaps',[50]);expect(first).toBeGreaterThanOrEqual(1);expect((await db.query('SELECT * FROM weekly_recaps WHERE user_id=$1',[b])).rows).toHaveLength(1);expect((await db.query('SELECT * FROM weekly_recaps WHERE user_id=$1',[c])).rows).toHaveLength(0);expect(await rpc('run_due_weekly_recaps',[50])).toBe(0);await expect(rpc('run_due_weekly_recaps',[101])).rejects.toThrow('Invalid recap batch');
});
it('denies client writes and service RPCs, isolates exports, and cascades account deletion',async()=>{
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${a}',false)`);for(const table of ['weekly_recaps','weekly_recap_preferences']){expect((await db.query<any>('SELECT * FROM '+table)).rows.every(row=>row.user_id===a)).toBe(true);await expect(db.query('DELETE FROM '+table)).rejects.toThrow('permission denied');}await expect(generate(b)).rejects.toThrow('permission denied');await expect(configure(a)).rejects.toThrow('permission denied');await expect(rpc('run_due_weekly_recaps',[50])).rejects.toThrow('permission denied');await db.exec('RESET ROLE;SET ROLE anon');await expect(db.query('SELECT * FROM weekly_recaps')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[a]);for(const table of ['weekly_recaps','weekly_recap_preferences'])expect((await db.query('SELECT * FROM '+table+' WHERE user_id=$1',[a])).rows).toHaveLength(0);
});
