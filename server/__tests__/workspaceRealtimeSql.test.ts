import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const topic = (id: string) => `zenos:workspace:${id}`;
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA realtime;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${a}'),('${b}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.topic',true) $$;
    CREATE TABLE realtime.messages(id bigserial PRIMARY KEY,topic text,extension text DEFAULT 'broadcast',event text,payload jsonb,private boolean DEFAULT true);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,auth,realtime TO anon,authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE ON realtime.messages TO anon,authenticated;
    GRANT USAGE ON SEQUENCE realtime.messages_id_seq TO anon,authenticated;
    CREATE POLICY existing_broad_policy ON realtime.messages TO anon,authenticated USING (true) WITH CHECK (true);
    -- Same signature/payload as Supabase's official realtime.broadcast_changes;
    -- a local outbox substitutes for the external Realtime service in SQL tests.
    CREATE FUNCTION realtime.broadcast_changes(topic_name text,event_name text,operation text,table_name text,table_schema text,new record,old record,level text DEFAULT 'ROW')
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO realtime.messages(topic,event,payload) VALUES(topic_name,event_name,jsonb_build_object('operation',operation,'table',table_name,'schema',table_schema,'record',new,'old_record',old));
      END; $$;`);
  await db.exec(readFileSync('supabase-schema.sql', 'utf8'));
  const migration = readFileSync('supabase-schema-update.sql', 'utf8');
  await db.exec(migration); await db.exec(migration);
  await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON tasks,categories,meetings,vault_items TO authenticated');
}, 30000);
afterAll(() => db.close());
const messages = () => db.query<{ topic: string; event: string; payload: any; private: boolean }>('SELECT topic,event,payload,private FROM realtime.messages ORDER BY id');
const identify = async (id: string, selected = id, role = 'authenticated') => {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await db.query("SELECT set_config('test.uid',$1,false),set_config('test.topic',$2,false)", [id, topic(selected)]);
};
it('installs triggers idempotently and broadcasts own INSERT/UPDATE/DELETE for all four tables', async () => {
  await identify(a);
  for (const [table, column] of [['tasks','title'],['categories','label'],['meetings','subject'],['vault_items','name']]) {
    const id = '10000000-0000-0000-0000-000000000001';
    await db.query(`INSERT INTO ${table}(id,user_id,${column}) VALUES($1,$2,'first')`, [id,a]);
    await db.query(`UPDATE ${table} SET ${column}='updated' WHERE id=$1`, [id]);
    await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
  }
  await db.exec('RESET ROLE'); const rows = (await messages()).rows;
  expect(rows).toHaveLength(12); expect(rows.every(row => row.topic === topic(a) && row.private)).toBe(true);
  for (const table of ['tasks','categories','meetings','vault_items']) {
    const events = rows.filter(row => row.payload.table === table);
    expect(events.map(row => row.event)).toEqual(['INSERT','UPDATE','DELETE']);
    expect(events[2].payload).toMatchObject({ schema:'public', operation:'DELETE', record:null, old_record:{user_id:a} });
  }
});
it('authorizes only the owner even when an existing permissive policy allows everything', async () => {
  await db.query("INSERT INTO tasks(user_id,title) VALUES($1,'other device')",[b]);
  await identify(a); expect((await messages()).rows.every(row=>row.topic===topic(a))).toBe(true);
  await identify(a,b); expect((await messages()).rows).toHaveLength(0);
  await identify(b); expect((await messages()).rows).toHaveLength(1);
  await identify('',a,'anon'); expect((await messages()).rows).toHaveLength(0);
});
it('prevents client-forged workspace broadcasts while preserving unrelated channel policies', async () => {
  await identify(a);
  await expect(db.query("INSERT INTO realtime.messages(topic,payload) VALUES($1,'{}')",[topic(a)])).rejects.toThrow('row-level security');
  await db.exec("INSERT INTO realtime.messages(topic,payload) VALUES('other-feature','{}')");
  expect((await messages()).rows.some(row=>row.topic==='other-feature')).toBe(true);
  await expect(db.query("UPDATE realtime.messages SET topic=$1 WHERE topic='other-feature'",[topic(a)])).rejects.toThrow('row-level security');
  expect((await db.query("UPDATE realtime.messages SET payload='{}' WHERE topic=$1 RETURNING id",[topic(a)])).rows).toHaveLength(0);
  await db.exec('RESET ROLE');
});
it('moves ownership with a private delete/insert pair without exposing the new owner to the old channel', async () => {
  const id = '20000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO tasks(id,user_id,title) VALUES($1,$2,'move')",[id,a]);
  await db.query('UPDATE tasks SET user_id=$1 WHERE id=$2',[b,id]);
  const rows = (await messages()).rows.slice(-2);
  expect(rows[0]).toMatchObject({topic:topic(a),event:'DELETE',payload:{record:null,old_record:{user_id:a}}});
  expect(rows[1]).toMatchObject({topic:topic(b),event:'INSERT',payload:{old_record:null,record:{user_id:b}}});
});
