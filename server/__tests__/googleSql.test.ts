import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${a}');
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;`);
  const all = readFileSync('supabase-schema-update.sql', 'utf8');
  const migration = all.slice(all.indexOf('-- Google provider refresh tokens'), all.indexOf('-- Per-user private Realtime'));
  await db.exec(migration); await db.exec(migration);
}, 20000);
afterAll(() => db.close());
it('allows service-role token lifecycle and denies even the owning authenticated browser every operation', async () => {
  await db.exec('SET ROLE service_role');
  await db.query('INSERT INTO google_tokens(user_id,refresh_token) VALUES ($1,$2)', [a, 'private']);
  expect((await db.query('SELECT refresh_token FROM google_tokens')).rows).toEqual([{ refresh_token: 'private' }]);
  await db.exec("UPDATE google_tokens SET refresh_token='rotated'");
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await expect(db.exec('SELECT * FROM google_tokens')).rejects.toThrow('permission denied');
    await expect(db.query('INSERT INTO google_tokens(user_id,refresh_token) VALUES ($1,$2)', [a, 'fake'])).rejects.toThrow('permission denied');
    await expect(db.exec("UPDATE google_tokens SET refresh_token='fake'")).rejects.toThrow('permission denied');
    await expect(db.exec('DELETE FROM google_tokens')).rejects.toThrow('permission denied');
  }
});
it('cascades when the owning auth account is deleted', async () => {
  await db.exec(`RESET ROLE; DELETE FROM auth.users WHERE id='${a}'`);
  expect((await db.query('SELECT * FROM google_tokens')).rows).toHaveLength(0);
});
