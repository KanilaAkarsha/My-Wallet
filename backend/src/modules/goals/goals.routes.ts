import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Account, SavingsContribution, SavingsGoal, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { withTransaction } from '../../database/connection.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { accountBalance, userProfile } from '../../services/ledger.service.js';
import { estimateCompletion, progressPercent } from '../../services/goals.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, money, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { enforceLimit, requireFeature } from '../billing/limits.js';
import { notifyMilestone } from '../notifications/notifications.service.js';

const create = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  targetAmount: decimal,
  currentAmount: decimal.default('0'),
  targetDate: isoDate.optional(),
  linkedAccountId: objectId.optional(),
  imageAttachmentId: objectId.optional(),
}).strict();
const patch = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).nullable(), targetAmount: decimal, targetDate: isoDate.nullable(), imageAttachmentId: objectId.nullable() }).partial().strict();
const flowBody = z.object({
  direction: z.enum(['contribution', 'withdrawal']),
  amount: decimal,
  accountId: objectId.optional(),
  date: isoDate.default(() => new Date()),
  note: z.string().max(300).optional(),
}).strict();

async function goalDto(userId: string, g: any, withFlows = false) {
  const cur = BigInt(g.currentMinor);
  const target = BigInt(g.targetMinor);
  const flows: any[] = await SavingsContribution.find({ userId, goalId: g._id }).sort({ date: -1 }).limit(withFlows ? 200 : 365).lean();
  const est = estimateCompletion(target, cur, flows.map((f) => ({ date: f.date, signedMinor: f.direction === 'contribution' ? BigInt(f.amountMinor) : -BigInt(f.amountMinor) })), new Date());
  return {
    id: String(g._id), name: g.name, description: g.description ?? null, currency: g.currency,
    target: money(target, g.currency), current: money(cur, g.currency), remaining: money(target > cur ? target - cur : 0n, g.currency),
    progressPercent: progressPercent(cur, target), targetDate: g.targetDate ?? null, status: g.status, completedAt: g.completedAt ?? null,
    linkedAccountId: g.linkedAccountId ? String(g.linkedAccountId) : null, imageAttachmentId: g.imageAttachmentId ? String(g.imageAttachmentId) : null,
    estimate: est && !est.reached ? { daysRemaining: est.daysRemaining, estimatedDate: est.estimatedDate, basis: 'average net savings over the last 90 days' } : est?.reached ? { reached: true } : null,
    ...(withFlows ? { contributions: flows.map((f) => ({ id: String(f._id), direction: f.direction, amount: money(BigInt(f.amountMinor), f.currency), date: f.date, note: f.note ?? null, accountId: f.accountId ? String(f.accountId) : null })) } : {}),
  };
}

export const goalsRouter = Router();
goalsRouter.use(requireAuth, requireFeature('goals'));

goalsRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await SavingsGoal.find({ userId, deletedAt: null, status: { $ne: 'archived' } }).sort({ createdAt: -1 }).lean();
  res.json({ goals: await Promise.all(rows.map((g) => goalDto(userId, g))) });
}));

goalsRouter.post('/', enforceLimit('savingsGoals', SavingsGoal, { status: { $ne: 'archived' } }), validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  const { currency } = await userProfile(userId);
  let goalCurrency = currency;
  if (b.linkedAccountId) {
    const a = await findOwned(Account, userId, b.linkedAccountId, 'Account', { deletedAt: null });
    goalCurrency = a.currency; // a goal lives in its account's currency
  }
  const g = await SavingsGoal.create({
    userId, name: b.name, description: b.description, currency: goalCurrency, targetMinor: toMinor(b.targetAmount, goalCurrency),
    currentMinor: toMinor(b.currentAmount, goalCurrency), targetDate: b.targetDate, linkedAccountId: b.linkedAccountId, imageAttachmentId: b.imageAttachmentId,
  });
  res.status(201).json(await goalDto(userId, g));
}));

goalsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  res.json(await goalDto(userId, await findOwned(SavingsGoal, userId, req.params.id, 'Goal', { deletedAt: null }), true));
}));

goalsRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const g = await findOwned(SavingsGoal, userId, req.params.id, 'Goal', { deletedAt: null });
  const b = req.body as z.infer<typeof patch>;
  if (b.name) g.name = b.name;
  if (b.description !== undefined) g.description = b.description ?? undefined;
  if (b.targetAmount) g.targetMinor = toMinor(b.targetAmount, g.currency);
  if (b.targetDate !== undefined) g.targetDate = b.targetDate ?? undefined;
  if (b.imageAttachmentId !== undefined) g.imageAttachmentId = b.imageAttachmentId ?? undefined;
  await g.save();
  res.json(await goalDto(userId, g));
}));

goalsRouter.post('/:id/archive', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const g = await findOwned(SavingsGoal, userId, req.params.id, 'Goal', { deletedAt: null });
  g.status = 'archived';
  await g.save();
  res.json(await goalDto(userId, g));
}));

/**
 * Contribution / withdrawal.
 *  - Goal WITH a linked savings account and a source accountId: money moves as an atomic transfer
 *    (never income or expense) and the goal balance is updated in the same database transaction.
 *  - Goal WITHOUT a linked account: tracked-allocation only; no ledger entry is written.
 */
goalsRouter.post('/:id/contributions', idempotent({ required: true }), validate({ params: idParams, body: flowBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof flowBody>;
  const key = req.header('idempotency-key')!;
  let before = 0;
  let after = 0;
  const out = await withTransaction(async (session) => {
    const g: any = await SavingsGoal.findOne({ _id: req.params.id, userId, deletedAt: null }).session(session);
    if (!g) throw notFound('Goal');
    if (g.status === 'archived') throw badRequest('Goal is archived');
    const amount = toMinor(b.amount, g.currency);
    if (amount <= 0n) throw badRequest('Amount must be greater than zero');
    const cur = BigInt(g.currentMinor);
    if (b.direction === 'withdrawal' && amount > cur) throw badRequest('Withdrawal exceeds the saved amount');
    before = progressPercent(cur, BigInt(g.targetMinor));

    let transferGroupId: string | undefined;
    if (b.accountId && g.linkedAccountId) {
      const src: any = await Account.findOne({ _id: b.accountId, userId, deletedAt: null, status: 'active' }).session(session);
      const dst: any = await Account.findOne({ _id: g.linkedAccountId, userId, deletedAt: null, status: 'active' }).session(session);
      if (!src || !dst) throw notFound('Account');
      if (src.currency !== g.currency || dst.currency !== g.currency) throw badRequest('Account currency must match the goal currency');
      if (String(src._id) === String(dst._id)) throw badRequest('Choose a source account different from the goal’s savings account');
      const [from, to] = b.direction === 'contribution' ? [src, dst] : [dst, src];
      if ((await accountBalance(userId, from, session)) < amount) throw badRequest('Insufficient funds in the source account');
      transferGroupId = randomBytes(12).toString('hex');
      const common = { userId, type: 'transfer', status: 'posted', transactionDate: b.date, transferGroupId, savingsGoalId: g._id, currency: g.currency, amountMinor: amount, description: b.note };
      await Transaction.create(
        [
          { ...common, accountId: from._id, direction: 'out', title: `Savings: ${g.name}`.slice(0, 120), idempotencyKey: `${key}:out` },
          { ...common, accountId: to._id, direction: 'in', title: `Savings: ${g.name}`.slice(0, 120), idempotencyKey: `${key}:in` },
        ],
        { session, ordered: true },
      );
    } else if (b.accountId) {
      throw badRequest('This goal has no linked savings account, so it only tracks an allocation. Omit accountId or link an account to the goal.');
    }
    const [flow] = await SavingsContribution.create(
      [{ userId, goalId: g._id, accountId: b.accountId, direction: b.direction, amountMinor: amount, currency: g.currency, date: b.date, note: b.note, idempotencyKey: key }],
      { session },
    );
    g.currentMinor = b.direction === 'contribution' ? cur + amount : cur - amount;
    after = progressPercent(BigInt(g.currentMinor), BigInt(g.targetMinor));
    if (BigInt(g.currentMinor) >= BigInt(g.targetMinor) && g.status === 'active') {
      g.status = 'completed';
      g.completedAt = new Date();
    } else if (g.status === 'completed' && BigInt(g.currentMinor) < BigInt(g.targetMinor)) {
      g.status = 'active';
      g.completedAt = undefined;
    }
    await g.save({ session });
    return { flowId: String(flow!._id), goal: g };
  }).catch((e) => {
    if ((e as { code?: number }).code === 11000) throw conflict('Duplicate contribution');
    throw e;
  });
  if (b.direction === 'contribution') await notifyMilestone(userId, out.goal, before, after).catch(() => undefined);
  res.status(201).json({ contributionId: out.flowId, goal: await goalDto(userId, out.goal) });
}));

export const _unused = oid;
