import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    INSERT INTO auth.users VALUES ('${a}'), ('${b}');
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role, anon;`);
  await db.exec(readFileSync('supabase-schema.sql', 'utf8'));
  const migration = readFileSync('supabase-schema-update.sql', 'utf8');
  await db.exec(migration); await db.exec(migration);
}, 30000);
afterAll(async () => db.close());
const consume = (id: string, kind = 'messages', limit = 20) => db.query<{ allowed: boolean; messages: number; transcriptions: number }>('SELECT * FROM public.consume_dante_usage($1, $2, $3)', [id, kind, limit]);
it('admits exactly 20 messages across repeated requests and stops further increments', async () => {
  await db.exec('SET ROLE service_role');
  const results = await Promise.all(Array.from({ length: 25 }, () => consume(a)));
  expect(results.filter(r => r.rows[0].allowed)).toHaveLength(20);
  expect(results.at(-1)?.rows[0]).toMatchObject({ allowed: false, messages: 20, transcriptions: 0 });
});
it('tracks transcription separately and isolates users and historical days', async () => {
  expect((await consume(a, 'transcriptions')).rows[0]).toMatchObject({ allowed: true, messages: 20, transcriptions: 1 });
  await db.query("INSERT INTO dante_usage(user_id, date, messages) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - 1, 20)", [b]);
  expect((await consume(b)).rows[0]).toMatchObject({ allowed: true, messages: 1, transcriptions: 0 });
});
it('enforces custom limits for transcriptions and rejects invalid reservations', async () => {
  expect((await consume(b, 'transcriptions', 1)).rows[0].allowed).toBe(true);
  expect((await consume(b, 'transcriptions', 1)).rows[0].allowed).toBe(false);
  await expect(consume(b, 'not-a-counter')).rejects.toThrow();
  await expect(consume(b, 'messages', 0)).rejects.toThrow();
});
it('allows authenticated users to see only their usage and prevents quota tampering', async () => {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('test.uid', '${b}', false)`);
  const rows = await db.query<{ user_id: string }>('SELECT * FROM dante_usage');
  expect(rows.rows).toHaveLength(2); expect(rows.rows.every(r => r.user_id === b)).toBe(true);
  await expect(consume(b)).rejects.toThrow('permission denied');
  await expect(db.exec('UPDATE dante_usage SET messages = 0')).rejects.toThrow('permission denied');
  await expect(db.query("INSERT INTO dante_usage(user_id,date) VALUES ($1,'2026-01-01')", [b])).rejects.toThrow('permission denied');
});
it('rejects anonymous reads and RPC calls, and cascades when the account is deleted', async () => {
  await db.exec('RESET ROLE; SET ROLE anon');
  await expect(db.query('SELECT * FROM dante_usage')).rejects.toThrow('permission denied');
  await expect(consume(a)).rejects.toThrow('permission denied');
  await db.exec(`RESET ROLE; DELETE FROM auth.users WHERE id = '${a}'`);
  expect((await db.query('SELECT * FROM dante_usage WHERE user_id = $1', [a])).rows).toHaveLength(0);
});
