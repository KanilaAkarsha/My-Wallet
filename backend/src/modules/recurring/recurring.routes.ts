import { Router } from 'express';
import { z } from 'zod';
import { Account, RecurringTransaction } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { validateSchedule, nextOccurrenceAfter } from '../../services/recurrence.js';
import { badRequest } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, money, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { enforceLimit, requireFeature } from '../billing/limits.js';
import { assertCategory } from '../transactions/transactions.service.js';
import { generateRecurring } from './recurring.service.js';

const create = z.object({
  title: z.string().trim().min(1).max(120), type: z.enum(['income', 'expense']), amount: decimal, accountId: objectId, categoryId: objectId.optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']), intervalDays: z.number().int().min(1).max(3660).optional(),
  startDate: isoDate, endDate: isoDate.optional(), autoPost: z.boolean().default(false),
}).strict();
const patch = z.object({ title: z.string().trim().min(1).max(120), amount: decimal, autoPost: z.boolean(), status: z.enum(['active', 'paused', 'archived']), endDate: isoDate.nullable() }).partial().strict();

const dto = (s: any) => ({
  id: String(s._id), title: s.title, type: s.type, amount: money(BigInt(s.amountMinor), s.currency), currency: s.currency, accountId: String(s.accountId),
  categoryId: s.categoryId ? String(s.categoryId) : null, frequency: s.recurrence.frequency, intervalDays: s.recurrence.intervalDays ?? null,
  startDate: s.recurrence.startDate, endDate: s.recurrence.endDate ?? null, autoPost: s.autoPost, status: s.status,
  nextRun: s.status === 'active' ? nextOccurrenceAfter({ ...s.recurrence.toObject?.() ?? s.recurrence }, s.lastGeneratedThrough ?? new Date(s.recurrence.startDate.getTime() - 1)) : null,
});

export const recurringRouter = Router();
recurringRouter.use(requireAuth, requireFeature('recurring'));

recurringRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await RecurringTransaction.find({ userId, deletedAt: null, status: { $ne: 'archived' } }).sort({ createdAt: -1 });
  res.json({ recurring: rows.map(dto) });
}));

recurringRouter.post('/', enforceLimit('recurring', RecurringTransaction, { status: { $ne: 'archived' } }), validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  const err = validateSchedule(b);
  if (err) throw badRequest(err);
  const acc = await findOwned(Account, userId, b.accountId, 'Account', { deletedAt: null });
  await assertCategory(userId, b.categoryId, b.type);
  const s = await RecurringTransaction.create({
    userId, title: b.title, type: b.type, amountMinor: toMinor(b.amount, acc.currency), currency: acc.currency, accountId: acc._id, categoryId: b.categoryId, autoPost: b.autoPost,
    recurrence: { frequency: b.frequency, intervalDays: b.intervalDays, startDate: b.startDate, endDate: b.endDate },
  });
  res.status(201).json(dto(s));
}));

recurringRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(RecurringTransaction, userId, req.params.id, 'Schedule', { deletedAt: null });
  const b = req.body as z.infer<typeof patch>;
  if (b.title) s.title = b.title;
  if (b.amount) s.amountMinor = toMinor(b.amount, s.currency);
  if (b.autoPost !== undefined) s.autoPost = b.autoPost;
  if (b.status) s.status = b.status;
  if (b.endDate !== undefined) s.recurrence.endDate = b.endDate ?? undefined;
  await s.save();
  res.json(dto(s));
}));

recurringRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const s = await findOwned(RecurringTransaction, userId, req.params.id, 'Schedule', { deletedAt: null });
  s.deletedAt = new Date();
  s.status = 'archived';
  await s.save();
  res.status(204).end();
}));

/** Same code path as the scheduled job; idempotent, so double-clicks are harmless. */
recurringRouter.post('/run', h(async (req, res) => {
  res.json(await generateRecurring(authed(req).userId));
}));
