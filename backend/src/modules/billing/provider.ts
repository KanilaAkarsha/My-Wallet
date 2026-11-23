import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Payment provider abstraction. Only a configured provider can take money; with none configured every
 * paid action returns 501 NOT_CONFIGURED. Payment success is NEVER assumed: plan changes happen only from
 * verified provider webhooks.
 *
 * The Stripe adapter below follows Stripe's public REST + webhook-signature documentation but has NOT been
 * exercised against a live Stripe account from this codebase. Confirm that Stripe (or an alternative such as a
 * local Sri Lankan gateway) supports your billing currency and payouts before launch.
 */
export interface CheckoutInput { userId: string; email: string; planCode: string; priceId: string; successUrl: string; cancelUrl: string; customerId?: string }
export interface PaymentProvider {
  name: string;
  createCheckout(i: CheckoutInput): Promise<{ url: string }>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): { id: string; type: string; data: { object: any } };
}

export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  return header.split(',').filter((p) => p.startsWith('v1=')).some((p) => {
    const sig = p.slice(3);
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

export function stripeProvider(secretKey: string, webhookSecret: string): PaymentProvider {
  const call = async (path: string, body?: URLSearchParams, method = body ? 'POST' : 'GET') => {
    const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(`stripe_${r.status}`);
    return j;
  };
  return {
    name: 'stripe',
    async createCheckout(i) {
      const p = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': i.priceId, 'line_items[0][quantity]': '1', success_url: i.successUrl, cancel_url: i.cancelUrl, client_reference_id: i.userId, 'metadata[userId]': i.userId, 'metadata[planCode]': i.planCode, 'subscription_data[metadata][userId]': i.userId, 'subscription_data[metadata][planCode]': i.planCode });
      if (i.customerId) p.set('customer', i.customerId);
      else p.set('customer_email', i.email);
      const s = await call('/checkout/sessions', p);
      return { url: s.url as string };
    },
    async cancelAtPeriodEnd(id) {
      await call(`/subscriptions/${encodeURIComponent(id)}`, new URLSearchParams({ cancel_at_period_end: 'true' }));
    },
    verifyWebhook(raw, sig) {
      if (!verifyStripeSignature(raw, sig, webhookSecret)) throw new Error('bad_signature');
      return JSON.parse(raw.toString('utf8'));
    },
  };
}

export function getProvider(): PaymentProvider | null {
  const e = env();
  if (e.PAYMENT_PROVIDER === 'stripe' && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) return stripeProvider(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET);
  return null;
}
