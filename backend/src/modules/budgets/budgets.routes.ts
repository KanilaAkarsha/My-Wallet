import { Router } from 'express';
import { z } from 'zod';
import { Budget, Category } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { userProfile } from '../../services/ledger.service.js';
import { enforceLimit } from '../billing/limits.js';
import { budgetDto, periodWindow } from './budgets.service.js';

const create = z
  .object({
    name: z.string().trim().min(1).max(80),
    period: z.enum(['monthly', 'weekly', 'custom']),
    amount: decimal,
    categoryIds: z.array(objectId).max(30).default([]),
    month: z.number().int().min(1).max(12).optional(),
    year: z.number().int().min(2000).max(2200).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    warnAtPercent: z.number().int().min(1).max(100).default(80),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.period === 'custom' && (!v.startDate || !v.endDate || v.endDate <= v.startDate)) ctx.addIssue({ code: 'custom', message: 'custom budgets need startDate < endDate', path: ['endDate'] });
  });
const patch = z.object({ name: z.string().trim().min(1).max(80), amount: decimal, warnAtPercent: z.number().int().min(1).max(100), categoryIds: z.array(objectId).max(30) }).partial().strict();

async function assertExpenseCategories(userId: string, ids: string[]) {
  if (!ids.length) return;
  const n = await Category.countDocuments({ _id: { $in: ids }, kind: 'expense', $or: [{ userId: null }, { userId }] });
  if (n !== new Set(ids).size) throw notFound('Category');
}

export const budgetsRouter = Router();
budgetsRouter.use(requireAuth);

budgetsRouter.get('/', validate({ query: z.object({ status: z.enum(['active', 'archived']).default('active') }) }), h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await Budget.find({ userId, deletedAt: null, status: req.query.status }).sort({ startDate: -1 }).lean();
  res.json({ budgets: await Promise.all(rows.map((b) => budgetDto(userId, b))) });
}));

budgetsRouter.post('/', enforceLimit('budgets', Budget, { status: 'active' }), validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  await assertExpenseCategories(userId, b.categoryIds);
  const { currency, timezone } = await userProfile(userId);
  const w = periodWindow(b.period, timezone, b);
  const doc = await Budget.create({ userId, name: b.name, period: b.period, categoryIds: b.categoryIds, amountMinor: toMinor(b.amount, currency), currency, warnAtPercent: b.warnAtPercent, ...w });
  res.status(201).json(await budgetDto(userId, doc));
}));

budgetsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  res.json(await budgetDto(userId, await findOwned(Budget, userId, req.params.id, 'Budget', { deletedAt: null }), true));
}));

budgetsRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = await findOwned(Budget, userId, req.params.id, 'Budget', { deletedAt: null });
  const body = req.body as z.infer<typeof patch>;
  if (body.categoryIds) {
    await assertExpenseCategories(userId, body.categoryIds);
    b.categoryIds = body.categoryIds;
  }
  if (body.name) b.name = body.name;
  if (body.amount) b.amountMinor = toMinor(body.amount, b.currency);
  if (body.warnAtPercent) b.warnAtPercent = body.warnAtPercent;
  await b.save();
  res.json(await budgetDto(userId, b));
}));

budgetsRouter.post('/:id/archive', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = await findOwned(Budget, userId, req.params.id, 'Budget', { deletedAt: null });
  b.status = 'archived';
  await b.save();
  res.json(await budgetDto(userId, b));
}));

budgetsRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = await findOwned(Budget, userId, req.params.id, 'Budget', { deletedAt: null });
  if (!b) throw badRequest('Budget not found');
  b.deletedAt = new Date();
  await b.save();
  res.status(204).end();
}));
