import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    INSERT INTO auth.users VALUES ('${user}'), ('${other}');`);
  await db.exec(readFileSync('supabase-schema.sql', 'utf8'));
  await db.exec(readFileSync('supabase-schema-update.sql', 'utf8'));
  await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    SET ROLE authenticated; SELECT set_config('test.uid', '${user}', false);`);
}, 30000);
afterAll(async () => db.close());
const payload = {
  categories: [{ id: 'local-one', label: ' Work ', color: 'blue' }, { id: 'local-two', label: 'work', color: 'red' }],
  tasks: [{ title: 'Imported task', cat: 'local-two', status: 'done', progress: 100, steps: [{ label: 'Step', done: true }], completedAt: '2026-10-25T10:00:00Z' }],
  meetings: [{ personName: 'Anna', subject: 'Meeting', notes: 'Notes', elapsedSeconds: 45 }],
  vault: [{ type: 'link', name: 'Docs', url: 'https://example.com' }],
};
const run = (data: unknown, batch: string) => db.query('SELECT public.import_local_data($1::jsonb, $2::uuid)', [JSON.stringify(data), batch]);
describe('Supabase import transaction', () => {
  it('maps categories by normalized label, imports every type, and preserves completion data', async () => {
    await db.query('INSERT INTO categories(user_id, label) VALUES ($1, $2)', [user, 'WORK']);
    await run(payload, '10000000-0000-0000-0000-000000000001');
    const cats = await db.query<{ id: string }>('SELECT id FROM categories');
    expect(cats.rows).toHaveLength(1);
    const tasks = await db.query<{ cat: string; completed_at: unknown; user_id: string }>('SELECT * FROM tasks');
    expect(tasks.rows[0].cat).toBe(cats.rows[0].id);
    expect(tasks.rows[0].user_id).toBe(user);
    expect(tasks.rows[0].completed_at).not.toBeNull();
    expect((await db.query('SELECT * FROM meetings')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM vault_items')).rows).toHaveLength(1);
  });
  it('does not duplicate data when a successful request is retried', async () => {
    await run(payload, '10000000-0000-0000-0000-000000000001');
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
  });
  it('rolls back every row on a later failure and permits a corrected retry', async () => {
    const batch = '10000000-0000-0000-0000-000000000002';
    await expect(run({ ...payload, meetings: [{ status: 'invalid' }] }, batch)).rejects.toThrow();
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
    await run(payload, batch);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(2);
    expect((await db.query('SELECT * FROM categories')).rows).toHaveLength(1);
  });
  it('uses the authenticated account, enforces RLS, and deduplicates new local labels', async () => {
    await db.exec(`SELECT set_config('test.uid', '${other}', false)`);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(0);
    await run(payload, '10000000-0000-0000-0000-000000000001');
    expect((await db.query('SELECT * FROM categories')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
  });
  it('rejects anonymous calls', async () => {
    await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('test.uid', '', false)");
    await expect(run(payload, '10000000-0000-0000-0000-000000000003')).rejects.toThrow('permission denied');
  });
});
