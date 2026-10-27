import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';

type Profile = { plan: 'free' | 'pro'; stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null };
export function profileIsPro(profile: Profile | null) {
  return profile?.plan === 'pro' && !!profile.current_period_end && Date.parse(profile.current_period_end) > Date.now();
}
export function createBilling(options: { env?: NodeJS.ProcessEnv; stripe?: Stripe; client?: SupabaseClient } = {}) {
  const env = options.env ?? process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const enabled = [env.STRIPE_SECRET_KEY, env.STRIPE_PRICE_ID, env.STRIPE_WEBHOOK_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, url].every(v => !!v?.trim());
  let stripeClient = options.stripe;
  let dbClient = options.client;
  const stripe = () => stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20000 });
  const db = () => dbClient ??= createClient(url!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  // Never derive payment redirects from an untrusted Host/Origin header or request body.
  const origin = () => {
    const value = new URL(env.BILLING_APP_URL || 'https://zenose.tech');
    if (value.protocol !== 'https:' && !(value.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(value.hostname))) throw new Error('Invalid billing origin');
    return value.origin;
  };
  async function profile(userId: string): Promise<Profile | null> {
    const { data, error } = await db().from('profiles').select('plan,stripe_customer_id,stripe_subscription_id,current_period_end').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('Billing storage unavailable');
    return data;
  }
  const isPro = async (userId: string) => enabled && profileIsPro(await profile(userId));
  const unavailable = (res: Parameters<RequestHandler>[1]) => res.status(503).json({ error: 'Billing is temporarily unavailable. Please try again shortly.' });
  const verifiedId = (req: Parameters<RequestHandler>[0]) => {
    const id = (req as any).userId;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  };
  const status: RequestHandler = (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ enabled }); };
  const account: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.json({ enabled: false, plan: 'free' });
    const userId = verifiedId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to manage your subscription.' });
    try { const row = await profile(userId); res.json({ enabled: true, plan: profileIsPro(row) ? 'pro' : 'free', hasCustomer: !!row?.stripe_customer_id }); } catch { unavailable(res); }
  };
  async function customer(userId: string) {
    let row = await profile(userId);
    if (row?.stripe_customer_id) return row.stripe_customer_id;
    // Stripe's stable idempotency key also covers concurrent initial checkout attempts.
    const created = await stripe().customers.create({ metadata: { user_id: userId } }, { idempotencyKey: `zenos-customer-${userId}` });
    const { error: insertError } = await db().from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (insertError) throw new Error('Billing storage unavailable');
    const { error } = await db().from('profiles').update({ stripe_customer_id: created.id, updated_at: new Date().toISOString() }).eq('user_id', userId).is('stripe_customer_id', null);
    if (error) throw new Error('Billing storage unavailable');
    row = await profile(userId);
    if (!row?.stripe_customer_id) throw new Error('Customer not saved');
    return row.stripe_customer_id;
  }
  const checkout: RequestHandler = async (req, res) => {
    if (!enabled) return unavailable(res);
    const userId = verifiedId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to upgrade your account.' });
    try {
      const customerId = await customer(userId);
      // Do not sell a second subscription while one is active or awaiting payment.
      for await (const subscription of stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
        if (!['canceled', 'incomplete_expired'].includes(subscription.status)) return res.status(409).json({ error: 'You already have a subscription. Use Manage subscription.' });
      }
      // Reuse an open Checkout session to prevent double subscriptions from repeated clicks/tabs.
      const open = await stripe().checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
      const existing = open.data.find(s => s.mode === 'subscription');
      if (existing?.url) return res.json({ url: existing.url });
      const session = await stripe().checkout.sessions.create({ mode: 'subscription', customer: customerId,
        line_items: [{ price: env.STRIPE_PRICE_ID!, quantity: 1 }],
        success_url: `${origin()}/billing/success`, cancel_url: `${origin()}/billing/cancel`,
      }, { idempotencyKey: `zenos-checkout-${userId}-${Math.floor(Date.now() / 1800000)}` });
      if (!session.url) throw new Error('Missing checkout URL');
      res.json({ url: session.url });
    } catch { unavailable(res); }
  };
  const portal: RequestHandler = async (req, res) => {
    if (!enabled) return unavailable(res);
    const userId = verifiedId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to manage your subscription.' });
    try {
      const row = await profile(userId);
      if (!row?.stripe_customer_id) return res.status(409).json({ error: 'No subscription customer exists for this account.' });
      const session = await stripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${origin()}/` });
      res.json({ url: session.url });
    } catch { unavailable(res); }
  };
  const webhook: RequestHandler = async (req, res) => {
    if (!enabled) return unavailable(res);
    let event: Stripe.Event;
    try {
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new Error('Missing signature/body');
      event = stripe().webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET!);
    } catch { return res.status(400).json({ error: 'Invalid webhook signature.' }); }
    if (!['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) return res.json({ received: true });
    try {
      const object = event.data.object as Stripe.Subscription | Stripe.Checkout.Session;
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      if (!customerId) throw new Error('Missing customer');
      // Never accept metadata/client_reference_id as an account mapping. Only our stored customer is trusted.
      const { data: owner, error } = await db().from('profiles').select('user_id,stripe_event_revision').eq('stripe_customer_id', customerId).maybeSingle();
      if (error) throw new Error('Billing storage unavailable');
      // Other products/customers on the same Stripe account do not belong to this app.
      if (!owner) return res.json({ received: true });
      // Read canonical current state, so delayed checkout/update/deletion payloads cannot revive a canceled plan.
      const paid: Stripe.Subscription[] = [];
      for await (const subscription of stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
        if (['active', 'trialing'].includes(subscription.status) && subscription.items.data.some(i => i.price.id === env.STRIPE_PRICE_ID && i.current_period_end * 1000 > Date.now())) paid.push(subscription);
      }
      const subscription = paid.sort((a, b) => b.created - a.created)[0];
      const end = subscription ? Math.max(...subscription.items.data.filter(i => i.price.id === env.STRIPE_PRICE_ID).map(i => i.current_period_end)) : null;
      const { error: saveError } = await db().rpc('apply_stripe_billing_event', {
        p_event_id: event.id, p_created: event.created, p_customer: customerId, p_expected_revision: owner.stripe_event_revision,
        p_subscription: subscription?.id ?? null, p_period_end: end ? new Date(end * 1000).toISOString() : null,
        p_plan: subscription ? 'pro' : 'free',
      });
      if (saveError) throw new Error('Billing storage unavailable');
      res.json({ received: true });
    } catch { unavailable(res); } // Non-2xx asks Stripe to retry; never log provider errors or secrets.
  };
  return { enabled, isPro, status, account, checkout, portal, webhook };
}
