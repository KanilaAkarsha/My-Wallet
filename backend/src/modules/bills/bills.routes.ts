import { Router } from 'express';
import { z } from 'zod';
import { Account, Bill, Transaction } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { nextOccurrenceAfter, validateSchedule } from '../../services/recurrence.js';
import { userProfile } from '../../services/ledger.service.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, money, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { assertCategory } from '../transactions/transactions.service.js';

const cats = ['electricity', 'water', 'internet', 'phone', 'rent', 'tuition', 'installment', 'other'] as const;
const recurrenceBody = z.object({ frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']), intervalDays: z.number().int().min(1).max(3660).optional(), endDate: isoDate.optional() }).strict();
const create = z.object({
  name: z.string().trim().min(1).max(80), category: z.enum(cats).default('other'), expectedAmount: decimal, accountId: objectId.optional(), categoryId: objectId.optional(),
  recurrence: recurrenceBody, firstDueDate: isoDate, reminderDaysBefore: z.array(z.number().int().min(0).max(60)).max(5).default([3, 1]),
}).strict();
const patch = z.object({ name: z.string().trim().min(1).max(80), expectedAmount: decimal, accountId: objectId.nullable(), reminderDaysBefore: z.array(z.number().int().min(0).max(60)).max(5), status: z.enum(['active', 'paused', 'archived']) }).partial().strict();
const payBody = z.object({ accountId: objectId, amount: decimal.optional(), date: isoDate.default(() => new Date()) }).strict();

const dayStart = (d = new Date()) => new Date(d.getTime() - (d.getTime() % 86_400_000));
function statusOf(b: any, now = new Date()) {
  const days = Math.ceil((b.nextDueDate.getTime() - now.getTime()) / 86_400_000);
  return b.status !== 'active' ? b.status : days < 0 ? 'overdue' : days <= 3 ? 'due_soon' : 'upcoming';
}
const dto = (b: any) => ({
  id: String(b._id), name: b.name, category: b.category, expectedAmount: money(BigInt(b.expectedAmountMinor), b.currency), currency: b.currency,
  accountId: b.accountId ? String(b.accountId) : null, recurrence: { frequency: b.recurrence.frequency, intervalDays: b.recurrence.intervalDays ?? null, endDate: b.recurrence.endDate ?? null },
  nextDueDate: b.nextDueDate, reminderDaysBefore: b.reminderDaysBefore, status: b.status, paymentStatus: statusOf(b),
});

export const billsRouter = Router();
billsRouter.use(requireAuth);

billsRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await Bill.find({ userId, deletedAt: null, status: { $ne: 'archived' } }).sort({ nextDueDate: 1 }).lean();
  res.json({ bills: rows.map(dto) });
}));

billsRouter.post('/', validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  const err = validateSchedule({ ...b.recurrence, startDate: b.firstDueDate });
  if (err) throw badRequest(err);
  const { currency, timezone } = await userProfile(userId);
  if (b.accountId) await findOwned(Account, userId, b.accountId, 'Account', { deletedAt: null });
  await assertCategory(userId, b.categoryId, 'expense');
  const doc = await Bill.create({ userId, name: b.name, category: b.category, expectedAmountMinor: toMinor(b.expectedAmount, currency), currency, accountId: b.accountId, categoryId: b.categoryId, recurrence: { ...b.recurrence, startDate: b.firstDueDate, timezone }, nextDueDate: b.firstDueDate, reminderDaysBefore: b.reminderDaysBefore });
  res.status(201).json(dto(doc));
}));

billsRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const bill = await findOwned(Bill, userId, req.params.id, 'Bill', { deletedAt: null });
  const b = req.body as z.infer<typeof patch>;
  if (b.accountId) await findOwned(Account, userId, b.accountId, 'Account', { deletedAt: null });
  if (b.name) bill.name = b.name;
  if (b.expectedAmount) bill.expectedAmountMinor = toMinor(b.expectedAmount, bill.currency);
  if (b.accountId !== undefined) bill.accountId = b.accountId ?? undefined;
  if (b.reminderDaysBefore) bill.reminderDaysBefore = b.reminderDaysBefore;
  if (b.status) bill.status = b.status;
  await bill.save();
  res.json(dto(bill));
}));

/**
 * Records a payment of the current occurrence as a posted expense and advances the due date.
 * The idempotency key is derived from (bill, due date), so paying the same occurrence twice is impossible
 * even without a client key.
 */
billsRouter.post('/:id/pay', idempotent(), validate({ params: idParams, body: payBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const bill = await findOwned(Bill, userId, req.params.id, 'Bill', { deletedAt: null });
  if (bill.status !== 'active') throw badRequest('Bill is not active');
  const b = req.body as z.infer<typeof payBody>;
  const acc = await findOwned(Account, userId, b.accountId, 'Account', { deletedAt: null });
  if (acc.status !== 'active') throw badRequest('Account is archived');
  if (acc.currency !== bill.currency) throw badRequest('Account currency must match the bill currency');
  const dueIso = bill.nextDueDate.toISOString();
  try {
    await Transaction.create({ userId, accountId: acc._id, type: 'expense', status: 'posted', title: bill.name, amountMinor: b.amount ? toMinor(b.amount, bill.currency) : bill.expectedAmountMinor, currency: bill.currency, categoryId: bill.categoryId, transactionDate: b.date, billId: bill._id, idempotencyKey: `bill:${bill._id}:${dueIso}` });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This bill occurrence has already been paid');
    throw e;
  }
  const next = nextOccurrenceAfter({ ...bill.recurrence.toObject?.() ?? bill.recurrence, startDate: bill.recurrence.startDate }, bill.nextDueDate);
  if (next) bill.nextDueDate = next;
  else bill.status = 'archived'; // schedule finished
  await bill.save();
  res.status(201).json(dto(bill));
}));

billsRouter.get('/:id/history', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const bill = await findOwned(Bill, userId, req.params.id, 'Bill', { deletedAt: null });
  const rows: any[] = await Transaction.find({ userId, billId: bill._id, deletedAt: null }).sort({ transactionDate: -1 }).limit(100).lean();
  res.json({ payments: rows.map((t) => ({ id: String(t._id), date: t.transactionDate, amount: money(BigInt(t.amountMinor), t.currency), status: t.status, accountId: String(t.accountId) })) });
}));

billsRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const bill = await findOwned(Bill, userId, req.params.id, 'Bill', { deletedAt: null });
  if (!bill) throw notFound('Bill');
  bill.deletedAt = new Date();
  await bill.save();
  res.status(204).end();
}));

export const _d = dayStart;
