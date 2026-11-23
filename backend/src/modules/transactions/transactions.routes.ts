import { Router } from 'express';
import { z } from 'zod';
import { Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { badRequest } from '../../shared/errors.js';
import { currencyCode, decimal, decodeCursor, encodeCursor, escapeRegex, h, idParams, isoDate, objectId, pageQuery, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { assertCategory, createTransaction, loadActiveAccount, reverseTransaction, txDto } from './transactions.service.js';

const tags = z.array(z.string().trim().min(1).max(30)).max(15);
const createBody = z
  .object({
    type: z.enum(['income', 'expense', 'refund', 'adjustment']),
    title: z.string().trim().min(1).max(120),
    amount: decimal,
    currency: currencyCode.optional(),
    accountId: objectId,
    categoryId: objectId.optional(),
    date: isoDate.default(() => new Date()),
    description: z.string().max(1000).optional(),
    notes: z.string().max(2000).optional(),
    tags: tags.optional(),
    status: z.enum(['pending', 'posted']).default('posted'),
    direction: z.enum(['in', 'out']).optional(),
    refundOf: objectId.optional(),
  })
  .strict();

const patchBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    amount: decimal,
    accountId: objectId,
    categoryId: objectId.nullable(),
    date: isoDate,
    description: z.string().max(1000).nullable(),
    notes: z.string().max(2000).nullable(),
    tags,
  })
  .partial()
  .strict();

const listQuery = pageQuery.extend({
  q: z.string().trim().max(80).optional(),
  type: z.enum(['income', 'expense', 'transfer', 'refund', 'adjustment', 'loan_interest']).optional(),
  status: z.enum(['pending', 'posted', 'reversed', 'failed']).optional(),
  accountId: objectId.optional(),
  categoryId: objectId.optional(),
  tag: z.string().max(30).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

transactionsRouter.get('/', validate({ query: listQuery }), h(async (req, res) => {
  const { userId } = authed(req);
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const filter: Record<string, unknown> = { userId: oid(userId), deletedAt: null };
  if (q.type) filter.type = q.type;
  if (q.status) filter.status = q.status;
  if (q.accountId) filter.accountId = oid(q.accountId);
  if (q.categoryId) filter.categoryId = oid(q.categoryId);
  if (q.tag) filter.tags = q.tag;
  if (q.q) filter.title = { $regex: escapeRegex(q.q), $options: 'i' };
  const date: Record<string, Date> = {};
  if (q.from) date.$gte = q.from;
  if (q.to) date.$lt = q.to;
  const cur = decodeCursor(q.cursor);
  const and: Record<string, unknown>[] = [];
  if (Object.keys(date).length) and.push({ transactionDate: date });
  if (cur) and.push({ $or: [{ transactionDate: { $lt: cur.d } }, { transactionDate: cur.d, _id: { $lt: oid(cur.i) } }] });
  const rows: any[] = await Transaction.find(and.length ? { ...filter, $and: and } : filter)
    .sort({ transactionDate: -1, _id: -1 })
    .limit(q.limit + 1)
    .lean();
  const more = rows.length > q.limit;
  const page = more ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  res.json({ items: page.map(txDto), nextCursor: more && last ? encodeCursor(last.transactionDate, last._id) : null });
}));

transactionsRouter.post('/', idempotent(), validate({ body: createBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof createBody>;
  const account = await loadActiveAccount(userId, b.accountId);
  const tx = await createTransaction(userId, {
    ...b, amountMinor: toMinor(b.amount, account.currency), idempotencyKey: req.header('idempotency-key') ?? undefined,
  });
  res.status(201).json(txDto(tx));
}));

transactionsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  res.json(txDto(await findOwned(Transaction, userId, req.params.id, 'Transaction', { deletedAt: null })));
}));

/** Reuse the details of an earlier transaction to prefill a new one. Creates nothing. */
transactionsRouter.get('/:id/template', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const t: any = await findOwned(Transaction, userId, req.params.id, 'Transaction', { deletedAt: null });
  if (t.type === 'transfer') throw badRequest('Use the transfers page to repeat a transfer');
  const d = txDto(t);
  res.json({ type: d.type, title: d.title, amount: d.amount, currency: d.currency, accountId: d.accountId, categoryId: d.categoryId, description: d.description, notes: d.notes, tags: d.tags });
}));

/** Drafts (pending) are fully editable; posted records only allow descriptive metadata changes. */
transactionsRouter.patch('/:id', validate({ params: idParams, body: patchBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const t: any = await findOwned(Transaction, userId, req.params.id, 'Transaction', { deletedAt: null });
  const b = req.body as z.infer<typeof patchBody>;
  const financial = ['amount', 'accountId', 'date'] as const;
  if (t.status !== 'pending') {
    if (financial.some((k) => b[k] !== undefined)) throw badRequest('Posted transactions cannot change amount, account or date. Reverse it and record a new one.');
    if (t.status !== 'posted') throw badRequest('This transaction can no longer be edited');
  }
  if (t.type === 'transfer' && (b.categoryId || b.amount)) throw badRequest('Transfers cannot be edited here');
  if (b.accountId && b.accountId !== String(t.accountId)) {
    const a = await loadActiveAccount(userId, b.accountId);
    if (a.currency !== t.currency) throw badRequest('Cannot move a transaction to an account with a different currency');
    t.accountId = a._id;
  }
  if (b.categoryId !== undefined) {
    await assertCategory(userId, b.categoryId, t.type === 'income' ? 'income' : 'expense');
    t.categoryId = b.categoryId ?? undefined;
  }
  if (b.amount !== undefined) t.amountMinor = toMinor(b.amount, t.currency);
  if (b.date !== undefined) t.transactionDate = b.date;
  for (const k of ['title', 'description', 'notes', 'tags'] as const) if (b[k] !== undefined) t[k] = b[k] ?? undefined;
  await t.save();
  res.json(txDto(t));
}));

transactionsRouter.post('/:id/post', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const t: any = await findOwned(Transaction, userId, req.params.id, 'Transaction', { deletedAt: null });
  if (t.status !== 'pending') throw badRequest('Only pending transactions can be posted');
  if (t.type === 'transfer') throw badRequest('Transfers are posted atomically when created');
  t.status = 'posted';
  await t.save();
  res.json(txDto(t));
}));

transactionsRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const t: any = await findOwned(Transaction, userId, req.params.id, 'Transaction', { deletedAt: null });
  if (t.status !== 'pending') throw badRequest('Only unposted transactions can be deleted. Reverse posted ones instead.');
  t.deletedAt = new Date();
  await t.save();
  res.status(204).end();
}));

transactionsRouter.post('/:id/reverse', idempotent(), validate({ params: idParams, body: z.object({ reason: z.string().max(300).optional() }).strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const r = await reverseTransaction(userId, req.params.id as string, req.body.reason);
  res.status(201).json({ original: txDto(r.original), reversal: txDto(r.reversal) });
}));
