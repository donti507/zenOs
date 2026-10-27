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
  await db.exec(`SET ROLE service_role; INSERT INTO profiles(user_id,stripe_customer_id) VALUES ('${a}','cus_a'),('${b}','cus_b')`);
}, 30000);
afterAll(() => db.close());
const apply = async (id: string, created: number, plan: string, customer = 'cus_a', revision?: number) => {
  const row = (await db.query<{ stripe_event_revision: number }>('SELECT stripe_event_revision FROM profiles WHERE stripe_customer_id=$1', [customer])).rows[0];
  return db.query('SELECT apply_stripe_billing_event($1,$2,$3,$4,$5,$6,$7)', [id, created, customer, plan === 'pro' ? 'sub_a' : null, plan === 'pro' ? '2099-01-01' : null, plan, revision ?? row?.stripe_event_revision]);
};
it('commits one receipt per event and ignores duplicate/older deliveries', async () => {
  await apply('evt_1', 10, 'pro');
  await apply('evt_1', 10, 'free');
  expect((await db.query('SELECT plan FROM profiles WHERE user_id=$1', [a])).rows[0]).toEqual({ plan: 'pro' });
  await apply('evt_3', 30, 'free'); await apply('evt_2', 20, 'pro');
  expect((await db.query('SELECT plan,stripe_subscription_id,current_period_end FROM profiles WHERE user_id=$1', [a])).rows[0]).toEqual({ plan: 'free', stripe_subscription_id: null, current_period_end: null });
  expect((await db.query('SELECT * FROM stripe_billing_events')).rows).toHaveLength(3);
});
it('rolls back receipts on failure and rejects invalid plans', async () => {
  await expect(apply('evt_invalid', 40, 'admin')).rejects.toThrow();
  expect((await db.query("SELECT * FROM stripe_billing_events WHERE event_id='evt_invalid'")).rows).toHaveLength(0);
});
it('rejects a stale concurrent snapshot without marking the event processed, then permits a fresh retry', async () => {
  await expect(apply('evt_race', 35, 'pro', 'cus_a', 0)).rejects.toThrow('Concurrent billing update');
  expect((await db.query("SELECT * FROM stripe_billing_events WHERE event_id='evt_race'")).rows).toHaveLength(0);
  await apply('evt_race', 35, 'free');
});
it('allows only own-row SELECT, denies all client mutations and webhook RPC execution', async () => {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('test.uid','${b}',false)`);
  expect((await db.query('SELECT user_id,plan FROM profiles')).rows).toEqual([{ user_id: b, plan: 'free' }]);
  await expect(db.exec("UPDATE profiles SET plan='pro'")).rejects.toThrow('permission denied');
  await expect(db.query('INSERT INTO profiles(user_id) VALUES ($1)', [b])).rejects.toThrow('permission denied');
  await expect(db.exec('DELETE FROM profiles')).rejects.toThrow('permission denied');
  await expect(apply('evt_forged', 99, 'pro', 'cus_b')).rejects.toThrow('permission denied');
  await expect(db.exec('SELECT * FROM stripe_billing_events')).rejects.toThrow('permission denied');
});
it('denies anonymous access and cascades profile deletion with auth.users', async () => {
  await db.exec('RESET ROLE; SET ROLE anon');
  await expect(db.exec('SELECT * FROM profiles')).rejects.toThrow('permission denied');
  await db.exec(`RESET ROLE; DELETE FROM auth.users WHERE id='${a}'`);
  expect((await db.query('SELECT * FROM profiles WHERE user_id=$1', [a])).rows).toHaveLength(0);
});
