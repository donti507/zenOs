import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    INSERT INTO auth.users VALUES ('${user}');`);
  await db.exec(readFileSync('supabase-schema.sql', 'utf8'));
  const sql = readFileSync('supabase-schema-update.sql', 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tasks, categories, meetings, vault_items TO authenticated;
    SET ROLE authenticated; SELECT set_config('test.uid','${user}',false)`);
}, 30000);
afterAll(() => db.close());
async function make(date: string, rule: string) {
  return (await db.query<{ id: string }>(`INSERT INTO tasks(user_id,title,date,recurrence,reminder,steps,progress,note) VALUES ($1,'Routine',$2,$3,$2 || 'T09:30','[{"label":"First","done":true}]',100,'Notes') RETURNING id`, [user, date, rule])).rows[0].id;
}
const done = (id: string) => db.query("UPDATE tasks SET status='done', completed_at=now() WHERE id=$1", [id]);
const children = (id: string) => db.query<any>('SELECT * FROM tasks WHERE recurrence_source_id=$1', [id]);
it.each([['daily','2026-12-31','2027-01-01'],['weekdays','2026-10-30','2026-11-02'],['weekly','2026-12-28','2027-01-04'],['monthly','2028-01-31','2028-02-29']])('creates the correct %s successor transactionally', async (rule,date,expected) => {
  const id = await make(date,rule); await done(id);
  const rows = (await children(id)).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ date: expected, status:'todo', recurrence: rule, progress:0, completed_at:null, note:'Notes', reminder:expected+'T09:30', steps:[{label:'First',done:false}] });
});
it('retains monthly anchors across February and repeated/reopened completions', async () => {
  const id=await make('2027-01-31','monthly');
  await Promise.all([done(id),done(id)]);
  const feb=(await children(id)).rows[0]; expect(feb.date).toBe('2027-02-28');
  await done(feb.id); expect((await children(feb.id)).rows[0].date).toBe('2027-03-31');
  await db.query("UPDATE tasks SET status='todo' WHERE id=$1",[id]); await done(id);
  expect((await children(id)).rows).toHaveLength(1);
});
it('never generates an occurrence for nonrecurring tasks or an unchanged completed status', async () => {
  const id=await make('2026-10-26','none'); await done(id); expect((await children(id)).rows).toHaveLength(0);
  await expect(make('2026-10-26','yearly')).rejects.toThrow();
});
it('preserves recurrence metadata and remaps source links when importing local tasks', async () => {
  const payload={categories:[],meetings:[],vault:[],tasks:[
    {id:'local-parent',title:'Imported recurring',date:'2027-01-31',status:'done',recurrence:'monthly',recurrenceDay:31},
    {id:'local-child',title:'Imported recurring',date:'2027-02-28',status:'todo',recurrence:'monthly',recurrenceDay:31,recurrenceSourceId:'local-parent'},
  ]};
  await db.query('SELECT import_local_data($1::jsonb,$2::uuid)',[JSON.stringify(payload),'10000000-0000-0000-0000-000000000009']);
  const rows=(await db.query<any>("SELECT * FROM tasks WHERE title='Imported recurring' ORDER BY date")).rows;
  expect(rows).toHaveLength(2); expect(rows[1].recurrence_source_id).toBe(rows[0].id);
  await db.query("UPDATE tasks SET status='todo' WHERE id=$1",[rows[0].id]); await done(rows[0].id);
  expect((await children(rows[0].id)).rows).toHaveLength(1);
  await done(rows[1].id); expect((await children(rows[1].id)).rows[0].date).toBe('2027-03-31');
});
