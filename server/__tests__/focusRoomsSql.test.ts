import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const db=new PGlite();const [a,b,c,d]=Array.from({length:4},()=>randomUUID());const room=randomUUID(),sa=randomUUID(),sb=randomUUID();
const rpc=async(name:string,args:any[]=[]) => (await db.query<any>(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0]?.result;
const snapshot=(user=a,id=room)=>rpc('focus_room_snapshot',[user,id]);
const enter=(user:string,id=room,session=randomUUID(),name='Guest',zone='UTC')=>rpc('enter_focus_room',[user,id,session,name,zone]);
const role=async(user:string,topic='zenos:focus:'+room,kind='authenticated')=>{await db.exec('RESET ROLE;SET ROLE '+kind);await db.query("SELECT set_config('test.uid',$1,false),set_config('test.topic',$2,false)",[user,topic]);};
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA realtime;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.topic',true) $$;
 CREATE TABLE realtime.messages(id bigserial PRIMARY KEY,topic text,extension text DEFAULT 'broadcast',event text,payload jsonb,private boolean DEFAULT true);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA public,auth,realtime TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON realtime.messages TO anon,authenticated;GRANT USAGE ON SEQUENCE realtime.messages_id_seq TO anon,authenticated;CREATE POLICY old_broad ON realtime.messages TO anon,authenticated USING(true) WITH CHECK(true);
 CREATE FUNCTION realtime.broadcast_changes(topic_name text,event_name text,operation text,table_name text,table_schema text,new record,old record,level text DEFAULT 'ROW') RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;
 CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages(topic,event,payload,private) VALUES(topic,event,payload,private); $$;`);
 for(const id of [a,b,c,d])await db.query('INSERT INTO auth.users VALUES($1)',[id]);await db.exec(readFileSync('supabase-schema.sql','utf8'));const sql=readFileSync('supabase-schema-update.sql','utf8');await db.exec(sql);await db.exec(sql);await db.exec('GRANT INSERT ON tasks TO service_role;SET ROLE service_role');
 await rpc('create_focus_room',[a,room,'Quiet corner']);await enter(a,room,sa,'Alice','Europe/Warsaw');await enter(b,room,sb,'Bob');
},30000);
beforeEach(()=>db.exec('RESET ROLE;SET ROLE service_role'));
afterAll(()=>db.close());
it('creates retry-safe private rooms, bounds owned rooms and never reuses someone else room ID',async()=>{
 expect(await rpc('create_focus_room',[a,room,'Quiet corner'])).toBe(room);await expect(rpc('create_focus_room',[b,room,'Quiet corner'])).rejects.toThrow('unavailable');await expect(snapshot(c)).rejects.toThrow('unavailable');
 for(let i=0;i<10;i++)await rpc('create_focus_room',[d,randomUUID(),'Room '+i]);await expect(rpc('create_focus_room',[d,randomUUID(),'Extra'])).rejects.toThrow('Ten active');
});
it('returns only chosen names, opaque membership/session IDs and canonical per-timezone completion streaks',async()=>{
 for(const n of [1,2])await db.query("INSERT INTO tasks(user_id,title,note,status,completed_at) VALUES($1,'PRIVATE_TASK','PRIVATE_NOTE','done',(((now() AT TIME ZONE 'UTC')::date-$2::integer)::timestamp AT TIME ZONE 'UTC')+interval '12 hours')",[b,n]);
 const state=await snapshot();expect(state.room.isHost).toBe(true);expect((await snapshot(b)).room.isHost).toBe(false);expect(state.members.find((m:any)=>m.name==='Bob').streak).toBe(2);expect(JSON.stringify(state)).not.toContain(b);expect(JSON.stringify(state)).not.toContain('PRIVATE');
 const second=randomUUID();await enter(b,room,second,'Bob');expect((await snapshot()).members.filter((m:any)=>m.name==='Bob')).toHaveLength(1);expect((await snapshot()).members.find((m:any)=>m.name==='Bob').sessions).toHaveLength(2);
 await enter(b,room,randomUUID(),'Bob');await expect(enter(b)).rejects.toThrow('Three tabs');await expect(enter(c,room,sb,'Forged')).rejects.toThrow('Session unavailable');expect((await snapshot()).members.some((m:any)=>m.name==='Forged')).toBe(false);
 await expect(enter(c,room,randomUUID(),'Guest','Invalid/Zone')).rejects.toThrow('Invalid time zone');
});
it('allows only the connected host to control a revision-checked server timer and broadcasts only invalidation metadata',async()=>{
 await expect(rpc('control_focus_room',[b,room,0,'start'])).rejects.toThrow('Host access');await rpc('control_focus_room',[a,room,0,'start']);let state=await snapshot();expect(state.room.revision).toBe(1);expect(state.room.startedAt).not.toBeNull();await expect(rpc('control_focus_room',[a,room,0,'pause'])).rejects.toThrow('Timer changed');
 await db.query("UPDATE focus_rooms SET started_at=now()-interval '25 minutes 2 seconds' WHERE id=$1",[room]);await rpc('control_focus_room',[a,room,1,'pause']);state=await snapshot();expect(state.room.elapsedSeconds).toBeGreaterThanOrEqual(1502);expect(state.room.startedAt).toBeNull();
 await rpc('control_focus_room',[a,room,2,'start']);expect((await snapshot()).room.elapsedSeconds).toBe(state.room.elapsedSeconds);await rpc('control_focus_room',[a,room,3,'reset']);state=await snapshot();expect(state.room).toMatchObject({revision:4,startedAt:null,elapsedSeconds:0});
 await db.exec('RESET ROLE');const outbox=(await db.query<any>("SELECT * FROM realtime.messages WHERE topic=$1",['zenos:focus:'+room])).rows;expect(outbox).toHaveLength(4);expect(outbox.every(row=>row.private&&row.event==='timer'&&Object.keys(row.payload).join(',')==='revision')).toBe(true);await db.exec('SET ROLE service_role');
});
it('authorizes only leased room members, blocks forged broadcasts despite broad policies and isolates topics',async()=>{
 const topic='zenos:focus:'+room;await role(a);expect(await rpc('can_access_focus_topic',[topic])).toBe(true);expect((await db.query('SELECT * FROM realtime.messages')).rows).toHaveLength(4);
 await db.query("INSERT INTO realtime.messages(topic,extension,payload) VALUES($1,'presence','{}')",[topic]);await expect(db.query("INSERT INTO realtime.messages(topic,extension,payload) VALUES($1,'broadcast','{}')",[topic])).rejects.toThrow('row-level security');
 expect((await db.query("UPDATE realtime.messages SET payload='{}' WHERE topic=$1 RETURNING id",[topic])).rows).toHaveLength(0);
 await role(a,'zenos:focus:'+randomUUID());expect((await db.query('SELECT * FROM realtime.messages')).rows).toHaveLength(0);
 await role(c);expect(await rpc('can_access_focus_topic',[topic])).toBe(false);expect((await db.query('SELECT * FROM realtime.messages')).rows).toHaveLength(0);await expect(db.query("INSERT INTO realtime.messages(topic,extension) VALUES($1,'presence')",[topic])).rejects.toThrow('row-level security');
 await role('',topic,'anon');expect((await db.query('SELECT * FROM realtime.messages')).rows).toHaveLength(0);await db.query("INSERT INTO realtime.messages(topic,extension) VALUES('unrelated','presence')");await db.exec('RESET ROLE;SET ROLE service_role');
});
it('expires stale presence leases, supports multi-tab leave, and blocks cross-user heartbeat/leave impersonation',async()=>{
 await expect(rpc('heartbeat_focus_room',[c,room,sa])).rejects.toThrow('Session unavailable');await rpc('leave_focus_room',[c,room,sa]);expect((await snapshot()).members.some((m:any)=>m.name==='Alice')).toBe(true);
 await db.query("UPDATE focus_room_sessions SET last_seen_at=now()-interval '121 seconds' WHERE user_id=$1",[b]);expect((await snapshot()).members.some((m:any)=>m.name==='Bob')).toBe(false);
 await role(b);expect(await rpc('can_access_focus_topic',['zenos:focus:'+room])).toBe(false);await db.exec('RESET ROLE;SET ROLE service_role');await rpc('heartbeat_focus_room',[b,room,sb]);expect((await snapshot()).members.find((m:any)=>m.name==='Bob').sessions).toHaveLength(1);
 await rpc('leave_focus_room',[b,room,sb]); // Other tabs still have rows but expired leases do not count online.
 await expect(rpc('control_focus_room',[b,room,4,'start'])).rejects.toThrow('Host access');
});
it('expires rooms after 24 hours, cannot revive them by join/heartbeat/control/create retries, and hides them from lists',async()=>{
 await db.query("UPDATE focus_rooms SET last_active_at=now()-interval '24 hours 1 second' WHERE id=$1",[room]);
 for(const [name,args] of [['focus_room_snapshot',[a,room]],['enter_focus_room',[a,room,sa,'Alice','UTC']],['heartbeat_focus_room',[a,room,sa]],['control_focus_room',[a,room,4,'start']],['create_focus_room',[a,room,'Quiet corner']]] as const)await expect(rpc(name,[...args])).rejects.toThrow();
 expect((await db.query<any>('SELECT * FROM list_focus_rooms($1)',[a])).rows).toHaveLength(0);await role(a);expect(await rpc('can_access_focus_topic',['zenos:focus:'+room])).toBe(false);await db.exec('RESET ROLE;SET ROLE service_role');
});
it('keeps table exports own-row only, prevents all direct writes/RPC escalation and cascades deletion',async()=>{
 await role(b);for(const table of ['focus_rooms','focus_room_members','focus_room_sessions']){expect((await db.query<any>('SELECT * FROM '+table)).rows.every(row=>row.user_id===b)).toBe(true);await expect(db.query('DELETE FROM '+table)).rejects.toThrow('permission denied');}
 await expect(rpc('focus_room_snapshot',[a,room])).rejects.toThrow('permission denied');await expect(rpc('create_focus_room',[a,randomUUID(),'Forged'])).rejects.toThrow('permission denied');await role('','zenos:focus:'+room,'anon');await expect(db.query('SELECT * FROM focus_rooms')).rejects.toThrow('permission denied');
 await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[a]);for(const table of ['focus_rooms','focus_room_members','focus_room_sessions'])expect((await db.query('SELECT * FROM '+table+' WHERE '+(table==='focus_rooms'?'id':'room_id')+'=$1',[room])).rows).toHaveLength(0);
});
