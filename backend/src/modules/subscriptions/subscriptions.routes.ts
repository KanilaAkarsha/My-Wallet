import { Router } from 'express';
import { z } from 'zod';
import { Account, Category, Subscription, Transaction } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { monthlyEquivalentMinor, nextOccurrenceAfter, yearlyEquivalentMinor } from '../../services/recurrence.js';
import { userProfile } from '../../services/ledger.service.js';
import { badRequest, conflict } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, money, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { requireFeature } from '../billing/limits.js';

const freq = z.enum(['weekly', 'monthly', 'quarterly', 'yearly']);
const create = z.object({
  name: z.string().trim().min(1).max(80), provider: z.string().max(80).optional(), kind: z.enum(['streaming', 'software', 'cloud', 'mobile', 'membership', 'other']).default('other'),
  amount: decimal, billingFrequency: freq, nextBillingDate: isoDate, paymentAccountId: objectId.optional(),
}).strict();
const patch = z.object({ name: z.string().trim().min(1).max(80), provider: z.string().max(80).nullable(), amount: decimal, billingFrequency: freq, nextBillingDate: isoDate, paymentAccountId: objectId.nullable() }).partial().strict();

const dto = (s: any) => {
  const amt = BigInt(s.amountMinor);
  return {
    id: String(s._id), name: s.name, provider: s.provider ?? null, kind: s.kind, amount: money(amt, s.currency), currency: s.currency, billingFrequency: s.billingFrequency,
    nextBillingDate: s.nextBillingDate, paymentAccountId: s.paymentAccountId ? String(s.paymentAccountId) : null, status: s.status, cancelledAt: s.cancelledAt ?? null,
    monthlyEquivalent: money(monthlyEquivalentMinor(amt, s.billingFrequency), s.currency), yearlyEquivalent: money(yearlyEquivalentMinor(amt, s.billingFrequency), s.currency),
  };
};

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth, requireFeature('subscriptions'));

subscriptionsRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await Subscription.find({ userId, deletedAt: null }).sort({ status: 1, nextBillingDate: 1 }).lean();
  const m: Record<string, bigint> = {};
  const y: Record<string, bigint> = {};
  for (const s of rows.filter((r) => r.status === 'active')) {
    m[s.currency] = (m[s.currency] ?? 0n) + monthlyEquivalentMinor(BigInt(s.amountMinor), s.billingFrequency);
    y[s.currency] = (y[s.currency] ?? 0n) + yearlyEquivalentMinor(BigInt(s.amountMinor), s.billingFrequency);
  }
  res.json({
    subscriptions: rows.map(dto),
    totals: Object.keys(m).map((c) => ({ currency: c, monthly: money(m[c]!, c), yearly: money(y[c]!, c) })),
    note: 'Cancelling here only records your decision. MyWallet cannot cancel subscriptions with the provider; do that in the provider’s app or website.',
  });
}));

subscriptionsRouter.post('/', validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  const { currency } = await userProfile(userId);
  let cur = currency;
  if (b.paymentAccountId) cur = (await findOwned(Account, userId, b.paymentAccountId, 'Account', { deletedAt: null })).currency;
  res.status(201).json(dto(await Subscription.create({ userId, name: b.name, provider: b.provider, kind: b.kind, amountMinor: toMinor(b.amount, cur), currency: cur, billingFrequency: b.billingFrequency, nextBillingDate: b.nextBillingDate, paymentAccountId: b.paymentAccountId })));
}));

subscriptionsRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(Subscription, userId, req.params.id, 'Subscription', { deletedAt: null });
  const b = req.body as z.infer<typeof patch>;
  if (b.paymentAccountId) await findOwned(Account, userId, b.paymentAccountId, 'Account', { deletedAt: null });
  if (b.name) s.name = b.name;
  if (b.provider !== undefined) s.provider = b.provider ?? undefined;
  if (b.amount) s.amountMinor = toMinor(b.amount, s.currency);
  if (b.billingFrequency) s.billingFrequency = b.billingFrequency;
  if (b.nextBillingDate) s.nextBillingDate = b.nextBillingDate;
  if (b.paymentAccountId !== undefined) s.paymentAccountId = b.paymentAccountId ?? undefined;
  await s.save();
  res.json(dto(s));
}));

subscriptionsRouter.post('/:id/cancel', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(Subscription, userId, req.params.id, 'Subscription', { deletedAt: null });
  s.status = 'cancelled';
  s.cancelledAt = new Date();
  await s.save();
  res.json(dto(s));
}));
subscriptionsRouter.post('/:id/reactivate', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(Subscription, userId, req.params.id, 'Subscription', { deletedAt: null });
  s.status = 'active';
  s.cancelledAt = undefined;
  await s.save();
  res.json(dto(s));
}));

/** Record that this renewal was charged: posts one expense (idempotent per billing date) and advances the date. */
subscriptionsRouter.post('/:id/record-payment', idempotent(), validate({ params: idParams, body: z.object({ accountId: objectId.optional() }).strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(Subscription, userId, req.params.id, 'Subscription', { deletedAt: null });
  if (s.status !== 'active') throw badRequest('Subscription is cancelled');
  const accId = req.body.accountId ?? (s.paymentAccountId ? String(s.paymentAccountId) : undefined);
  if (!accId) throw badRequest('Choose the account that was charged');
  const acc = await findOwned(Account, userId, accId, 'Account', { deletedAt: null });
  if (acc.currency !== s.currency) throw badRequest('Account currency must match the subscription currency');
  const cat: any = await Category.findOne({ userId: null, kind: 'expense', name: 'Subscriptions' }).lean();
  try {
    await Transaction.create({ userId, accountId: acc._id, type: 'expense', status: 'posted', title: s.name, amountMinor: s.amountMinor, currency: s.currency, categoryId: cat?._id, transactionDate: s.nextBillingDate, subscriptionId: s._id, idempotencyKey: `sub:${s._id}:${s.nextBillingDate.toISOString()}` });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This renewal has already been recorded');
    throw e;
  }
  const step = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' }[s.billingFrequency as string] as 'monthly';
  s.nextBillingDate = nextOccurrenceAfter({ frequency: step, startDate: s.nextBillingDate }, s.nextBillingDate)!;
  await s.save();
  res.status(201).json(dto(s));
}));

subscriptionsRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(Subscription, userId, req.params.id, 'Subscription', { deletedAt: null });
  s.deletedAt = new Date();
  await s.save();
  res.status(204).end();
}));
