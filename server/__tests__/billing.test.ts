import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import Stripe from 'stripe';
import { createBilling, profileIsPro } from '../billing';

const uid = '00000000-0000-0000-0000-000000000001';
const env = { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_ID: 'price_pro', STRIPE_WEBHOOK_SECRET: 'whsec_test', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'test-service', BILLING_APP_URL: 'http://localhost:3000' };
let server: Server; let base: string; let stripe: Stripe; let db: any; let rows: Map<string, any>; let subscriptions: any[];
function database() {
  const from = vi.fn(() => {
    let filters: [string, unknown][] = []; let operation = 'select'; let values: any; let ignore = false;
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (data: any) => { operation = 'update'; values = data; return query; },
      upsert: (data: any, options: any) => { operation = 'upsert'; values = data; ignore = options.ignoreDuplicates; return query; },
      maybeSingle: async () => ({ data: [...rows.values()].map(row => ({ stripe_event_revision: 0, ...row })).find(row => filters.every(([k, v]) => row[k] === v)) ?? null, error: null }),
      then: (resolve: any) => {
        if (operation === 'upsert' && !(ignore && rows.has(values.user_id))) rows.set(values.user_id, { plan: 'free', stripe_customer_id: null, ...values });
        if (operation === 'update') for (const row of rows.values()) if (filters.every(([k, v]) => row[k] === v)) Object.assign(row, values);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return query;
  });
  return { from, rpc: vi.fn().mockResolvedValue({ error: null }) };
}
async function start(overrides = {}) {
  const billing = createBilling({ env: { ...env, ...overrides }, stripe, client: db });
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), billing.webhook);
  app.use(express.json());
  // Test auth boundary: this header stands for requireUser's verified output, never body data.
  app.use((req, _res, next) => { (req as any).userId = req.headers['x-verified-user']; next(); });
  app.get('/status', billing.status); app.get('/account', billing.account);
  app.post('/checkout', billing.checkout); app.post('/portal', billing.portal);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  return billing;
}
const post = (path: string, body = {}, id = uid) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-verified-user': id }, body: JSON.stringify(body) });
const webhook = (type: string, object: any, signature = true) => {
  const body = JSON.stringify({ id: 'evt_test', created: 100, type, data: { object } });
  return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature ? stripe.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET }) : 'bad' }, body });
};
beforeEach(() => {
  rows = new Map(); subscriptions = [];
  db = database(); stripe = new Stripe(env.STRIPE_SECRET_KEY);
  vi.spyOn(stripe.customers, 'create').mockResolvedValue({ id: 'cus_owner' } as any);
  vi.spyOn(stripe.subscriptions, 'list').mockImplementation(() => ({ async *[Symbol.asyncIterator]() { yield* subscriptions; } }) as any);
  vi.spyOn(stripe.checkout.sessions, 'list').mockResolvedValue({ data: [] } as any);
  vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ url: 'https://checkout.stripe.com/test' } as any);
  vi.spyOn(stripe.billingPortal.sessions, 'create').mockResolvedValue({ url: 'https://billing.stripe.com/test' } as any);
});
afterEach(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }); vi.restoreAllMocks(); });
it.each(['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])('is disabled without %s and never touches Stripe/storage', async key => {
  const billing = await start({ [key]: ' ' });
  expect(billing.enabled).toBe(false);
  expect(await (await fetch(base + '/status')).json()).toEqual({ enabled: false });
  expect((await post('/checkout')).status).toBe(503); expect((await post('/portal')).status).toBe(503);
  expect(db.from).not.toHaveBeenCalled(); expect(stripe.customers.create).not.toHaveBeenCalled();
});
it('rejects local/anonymous callers and ignores body IDs and redirect URLs', async () => {
  await start();
  expect((await post('/checkout', { userId: uid }, 'anon:local')).status).toBe(401);
  expect((await post('/portal', { userId: uid }, '')).status).toBe(401);
  const response = await post('/checkout', { user_id: 'victim', customer: 'cus_victim', success_url: 'https://evil.test' });
  expect(response.status).toBe(200);
  expect(stripe.customers.create).toHaveBeenCalledWith({ metadata: { user_id: uid } }, { idempotencyKey: `zenos-customer-${uid}` });
  expect(rows.get(uid).stripe_customer_id).toBe('cus_owner'); expect(rows.has('victim')).toBe(false);
  expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_owner', line_items: [{ price: 'price_pro', quantity: 1 }], success_url: 'http://localhost:3000/billing/success' }), expect.anything());
});
it('reuses a stored customer, preserves the plan and uses only that customer in the portal', async () => {
  rows.set(uid, { user_id: uid, plan: 'pro', stripe_customer_id: 'cus_existing', current_period_end: new Date(Date.now() + 100000).toISOString() });
  await start();
  const account = await (await fetch(base + '/account', { headers: { 'x-verified-user': uid } })).json();
  expect(account).toEqual({ enabled: true, plan: 'pro', hasCustomer: true });
  expect(JSON.stringify(account)).not.toContain('cus_existing');
  expect((await post('/portal', { customer: 'cus_victim', return_url: 'https://evil.test' })).status).toBe(200);
  expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_existing', return_url: 'http://localhost:3000/' });
  expect(stripe.customers.create).not.toHaveBeenCalled();
});
it('reuses an open checkout and refuses a second ongoing subscription', async () => {
  rows.set(uid, { user_id: uid, plan: 'free', stripe_customer_id: 'cus_owner' }); await start();
  vi.mocked(stripe.checkout.sessions.list).mockResolvedValue({ data: [{ mode: 'subscription', url: 'https://checkout.stripe.com/open' }] } as any);
  expect(await (await post('/checkout')).json()).toEqual({ url: 'https://checkout.stripe.com/open' });
  expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  subscriptions = [{ status: 'past_due' }];
  expect((await post('/checkout')).status).toBe(409);
});
it('verifies signatures on the raw body and rejects forged requests before storage', async () => {
  await start();
  expect((await webhook('customer.subscription.updated', { customer: 'cus_owner' }, false)).status).toBe(400);
  expect(db.from).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled();
});
it.each(['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'])('reconciles %s from current Stripe data, never metadata or the payload plan', async type => {
  rows.set(uid, { user_id: uid, plan: 'free', stripe_customer_id: 'cus_owner' });
  subscriptions = [{ id: 'sub_real', status: 'active', created: 99, items: { data: [{ price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 3600 }] } }];
  await start();
  expect((await webhook(type, { customer: 'cus_owner', metadata: { user_id: 'victim' }, status: 'canceled' })).status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith('apply_stripe_billing_event', expect.objectContaining({ p_event_id: 'evt_test', p_customer: 'cus_owner', p_plan: 'pro', p_subscription: 'sub_real' }));
});
it('downgrades canceled, unpaid and wrong-price subscriptions and ignores unrelated customers', async () => {
  rows.set(uid, { user_id: uid, stripe_customer_id: 'cus_owner' }); await start();
  subscriptions = [{ status: 'canceled' }, { status: 'past_due' }, { status: 'active', items: { data: [{ price: { id: 'price_other' }, current_period_end: 9999999999 }] } }];
  expect((await webhook('customer.subscription.deleted', { customer: 'cus_owner' })).status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith('apply_stripe_billing_event', expect.objectContaining({ p_plan: 'free', p_subscription: null, p_period_end: null }));
  db.rpc.mockClear();
  expect((await webhook('checkout.session.completed', { customer: 'cus_other', metadata: { user_id: uid } })).status).toBe(200);
  expect(db.rpc).not.toHaveBeenCalled();
});
it('returns retryable errors without leaking upstream details or secrets', async () => {
  rows.set(uid, { user_id: uid, stripe_customer_id: 'cus_owner' }); await start();
  db.rpc.mockResolvedValue({ error: new Error('SECRET_PROVIDER_DETAIL') });
  const response = await webhook('customer.subscription.deleted', { customer: 'cus_owner' });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('SECRET_PROVIDER_DETAIL');
});
it('never treats expired or client-supplied plan claims as an entitlement', () => {
  expect(profileIsPro({ plan: 'pro', current_period_end: '2000-01-01', stripe_customer_id: null, stripe_subscription_id: null })).toBe(false);
  expect(profileIsPro(null)).toBe(false);
});
