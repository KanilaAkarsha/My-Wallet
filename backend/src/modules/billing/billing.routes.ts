import express, { Router } from 'express';
import { z } from 'zod';
import { Account, Budget, BillingSubscription, Payment, RecurringTransaction, SavingsGoal, SubscriptionPlan, User } from '../../database/models/index.js';
import { env } from '../../config/env.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError, badRequest, conflict } from '../../shared/errors.js';
import { h, money } from '../../shared/http.js';
import { logger } from '../../shared/logger.js';
import { PLAN_DEFAULTS } from '../../services/seed.js';
import { effectivePlan } from './limits.js';
import { getProvider } from './provider.js';

const notConfigured = () => new AppError(501, 'NOT_CONFIGURED', 'Online payments are not configured on this server yet.');
const planBody = z.object({ planCode: z.enum(['plus', 'premium']) }).strict();

async function usage(userId: string) {
  const [accounts, budgets, goals, recurring] = await Promise.all([
    Account.countDocuments({ userId, deletedAt: null, status: 'active' }), Budget.countDocuments({ userId, deletedAt: null, status: 'active' }),
    SavingsGoal.countDocuments({ userId, deletedAt: null, status: { $ne: 'archived' } }), RecurringTransaction.countDocuments({ userId, deletedAt: null, status: { $ne: 'archived' } }),
  ]);
  return { accounts, budgets, savingsGoals: goals, recurring };
}

export const billingRouter = Router();
export const billingWebhookRouter = Router();

/**
 * Webhook: verified signature => state change. Must be registered with a RAW body (done here), and
 * is idempotent (payments are unique by provider id; state writes are absolute, not incremental).
 */
billingWebhookRouter.post('/', express.raw({ type: 'application/json', limit: '1mb' }), h(async (req, res) => {
  const provider = getProvider();
  if (!provider) throw notConfigured();
  let event;
  try {
    event = provider.verifyWebhook(req.body as Buffer, req.header('stripe-signature'));
  } catch {
    throw badRequest('Invalid signature');
  }
  const o = event.data.object;
  const userId: string | undefined = o.metadata?.userId ?? o.subscription_details?.metadata?.userId ?? o.client_reference_id;
  const sub = userId ? undefined : await BillingSubscription.findOne({ providerSubscriptionId: o.subscription ?? o.id }).lean();
  const uid = userId ?? (sub ? String(sub.userId) : undefined);
  if (!uid) return void res.json({ received: true, ignored: true });
  switch (event.type) {
    case 'checkout.session.completed':
      await BillingSubscription.updateOne({ userId: uid }, { $set: { planCode: o.metadata?.planCode ?? 'plus', status: 'active', provider: provider.name, providerCustomerId: o.customer, providerSubscriptionId: o.subscription, cancelAtPeriodEnd: false, pendingPlanCode: null } }, { upsert: true });
      break;
    case 'invoice.paid': {
      const end = o.lines?.data?.[0]?.period?.end;
      await BillingSubscription.updateOne({ userId: uid }, { $set: { status: 'active', ...(end ? { currentPeriodEnd: new Date(end * 1000) } : {}) } });
      try { await Payment.create({ userId: uid, planCode: o.metadata?.planCode, amountMinor: BigInt(o.amount_paid ?? 0), currency: String(o.currency).toUpperCase(), status: 'succeeded', provider: provider.name, providerPaymentId: o.id, paidAt: new Date() }); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
      break;
    }
    case 'invoice.payment_failed':
      await BillingSubscription.updateOne({ userId: uid }, { $set: { status: 'past_due' } });
      try { await Payment.create({ userId: uid, amountMinor: BigInt(o.amount_due ?? 0), currency: String(o.currency).toUpperCase(), status: 'failed', provider: provider.name, providerPaymentId: o.id }); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
      break;
    case 'customer.subscription.updated':
      await BillingSubscription.updateOne({ userId: uid }, { $set: { cancelAtPeriodEnd: !!o.cancel_at_period_end, ...(o.current_period_end ? { currentPeriodEnd: new Date(o.current_period_end * 1000) } : {}) } });
      break;
    case 'customer.subscription.deleted':
      await BillingSubscription.updateOne({ userId: uid }, { $set: { status: 'cancelled', cancelAtPeriodEnd: false } });
      break;
    default:
      logger.debug({ type: event.type }, 'billing webhook ignored');
  }
  res.json({ received: true });
}));

billingRouter.use(requireAuth);

billingRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const plan = await effectivePlan(userId);
  const sub: any = await BillingSubscription.findOne({ userId }).lean();
  const plans: any[] = await SubscriptionPlan.find({ active: true }).sort({ priceMinor: 1 }).lean();
  const u = await usage(userId);
  const payments: any[] = await Payment.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    providerConfigured: !!getProvider(),
    current: { code: plan.code, status: plan.status, features: plan.features, limits: plan.limits, trialEndsAt: sub?.trialEndsAt ?? null, currentPeriodEnd: sub?.currentPeriodEnd ?? null, cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd, trialAvailable: !sub?.trialUsed, pendingPlanCode: sub?.pendingPlanCode ?? null },
    usage: Object.entries(u).map(([key, used]) => ({ key, used, limit: plan.limits[key] ?? 0, overLimit: used > (plan.limits[key] ?? 0) })),
    plans: plans.map((p) => ({ code: p.code, name: p.name, price: money(BigInt(p.priceMinor), p.currency), currency: p.currency, interval: p.interval, trialDays: p.trialDays, limits: p.limits, features: p.features, purchasable: !!p.providerPriceId && !!getProvider() })),
    payments: payments.map((p) => ({ id: String(p._id), date: p.paidAt ?? p.createdAt, amount: money(BigInt(p.amountMinor), p.currency), status: p.status, planCode: p.planCode ?? null })),
    notes: ['Downgrading or cancelling never deletes or hides your historical records; it only limits creating NEW items beyond the plan’s allowance and the reporting window.'],
  });
}));

/** Free trial (no card, no payment). One per account. */
billingRouter.post('/trial', validate({ body: planBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const existing: any = await BillingSubscription.findOne({ userId }).lean();
  if (existing?.trialUsed) throw conflict('You have already used your free trial');
  const plan: any = (await SubscriptionPlan.findOne({ code: req.body.planCode }).lean()) ?? PLAN_DEFAULTS.find((p) => p.code === req.body.planCode);
  const days = plan?.trialDays ?? 14;
  await BillingSubscription.updateOne({ userId }, { $set: { planCode: req.body.planCode, status: 'trialing', trialEndsAt: new Date(Date.now() + days * 86_400_000), trialUsed: true, cancelAtPeriodEnd: false } }, { upsert: true });
  res.status(201).json({ planCode: req.body.planCode, trialDays: days, note: 'No payment was taken. When the trial ends you return to Free; nothing is deleted.' });
}));

billingRouter.post('/checkout', validate({ body: planBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const provider = getProvider();
  if (!provider) throw notConfigured();
  const plan: any = await SubscriptionPlan.findOne({ code: req.body.planCode, active: true }).lean();
  if (!plan?.providerPriceId) throw new AppError(501, 'NOT_CONFIGURED', 'This plan has no provider price configured yet.');
  const u: any = await User.findById(userId).select('email').lean();
  const sub: any = await BillingSubscription.findOne({ userId }).lean();
  const out = await provider.createCheckout({ userId, email: u.email, planCode: plan.code, priceId: plan.providerPriceId, successUrl: `${env().APP_ORIGIN}/settings/subscription?checkout=success`, cancelUrl: `${env().APP_ORIGIN}/settings/subscription?checkout=cancelled`, customerId: sub?.providerCustomerId });
  res.json(out);
}));

/** Cancel: provider subscriptions end at period end; trials end now. History is untouched either way. */
billingRouter.post('/cancel', h(async (req, res) => {
  const { userId } = authed(req);
  const sub: any = await BillingSubscription.findOne({ userId });
  if (!sub || sub.planCode === 'free') throw badRequest('You are on the Free plan');
  if (sub.providerSubscriptionId) {
    const provider = getProvider();
    if (!provider) throw notConfigured();
    await provider.cancelAtPeriodEnd(sub.providerSubscriptionId);
    sub.cancelAtPeriodEnd = true;
  } else {
    sub.status = 'cancelled';
    sub.trialEndsAt = new Date();
    sub.currentPeriodEnd = new Date();
  }
  await sub.save();
  res.json({ cancelled: true, effective: sub.providerSubscriptionId ? 'at the end of the current period' : 'now' });
}));

/** Downgrade between paid plans is applied at period end by the provider flow; here we only record intent for display. */
billingRouter.post('/downgrade', validate({ body: z.object({ planCode: z.enum(['free', 'plus']) }).strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const sub: any = await BillingSubscription.findOne({ userId });
  if (!sub) throw badRequest('You are already on the Free plan');
  if (req.body.planCode === 'free') return void res.redirect(307, '/api/v1/billing/cancel');
  if (!getProvider()) throw notConfigured();
  sub.pendingPlanCode = req.body.planCode;
  await sub.save();
  res.json({ pendingPlanCode: sub.pendingPlanCode, note: 'Your plan changes at the end of the current billing period.' });
}));
