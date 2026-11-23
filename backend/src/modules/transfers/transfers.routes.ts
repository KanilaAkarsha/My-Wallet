import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Account, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { withTransaction } from '../../database/connection.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { buildTransfer } from '../../services/finance/ledger.js';
import { MoneyError } from '../../services/finance/money.js';
import { accountBalance } from '../../services/ledger.service.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { decimal, decodeCursor, encodeCursor, h, isoDate, money, objectId, pageQuery, toMinor } from '../../shared/http.js';
import { txDto } from '../transactions/transactions.service.js';

const body = z
  .object({
    fromAccountId: objectId,
    toAccountId: objectId,
    amount: decimal,
    rate: z.string().regex(/^\d+(\.\d{1,12})?$/).optional(),
    destinationAmount: decimal.optional(),
    date: isoDate.default(() => new Date()),
    description: z.string().max(500).optional(),
    allowOverdraft: z.boolean().default(false),
  })
  .strict();

const groupDto = (out: any, inn: any) => ({
  groupId: out.transferGroupId,
  fromAccountId: String(out.accountId),
  toAccountId: String(inn.accountId),
  amount: money(BigInt(out.amountMinor), out.currency),
  currency: out.currency,
  destinationAmount: money(BigInt(inn.amountMinor), inn.currency),
  destinationCurrency: inn.currency,
  conversion: out.transferConversion?.rate ? { rate: out.transferConversion.rate, from: out.transferConversion.fromCurrency, to: out.transferConversion.toCurrency } : null,
  date: out.transactionDate,
  description: out.description ?? null,
  status: out.status === 'reversed' ? 'reversed' : out.status,
  legs: { out: txDto(out), in: txDto(inn) },
});

export const transfersRouter = Router();
transfersRouter.use(requireAuth);

transfersRouter.post('/', idempotent({ required: true }), validate({ body }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof body>;
  const key = req.header('idempotency-key')!;
  const groupId = randomBytes(12).toString('hex');

  const result = await withTransaction(async (session) => {
    // Both accounts are loaded INSIDE the transaction and scoped to the authenticated user.
    const accounts: any[] = await Account.find({ _id: { $in: [oid(b.fromAccountId), oid(b.toAccountId)] }, userId, deletedAt: null }).session(session);
    const from = accounts.find((a) => String(a._id) === b.fromAccountId);
    const to = accounts.find((a) => String(a._id) === b.toAccountId);
    if (!from || !to) throw notFound('Account'); // same answer for "missing" and "someone else's"
    const sourceBalanceMinor = await accountBalance(userId, from, session);
    let built;
    try {
      built = buildTransfer({
        userId,
        from: { id: String(from._id), userId: String(from.userId), currency: from.currency, status: from.status },
        to: { id: String(to._id), userId: String(to.userId), currency: to.currency, status: to.status },
        amountMinor: toMinor(b.amount, from.currency),
        date: b.date,
        transferGroupId: groupId,
        rate: b.rate,
        destinationAmountMinor: b.destinationAmount ? toMinor(b.destinationAmount, to.currency) : undefined,
        sourceBalanceMinor,
        allowOverdraft: b.allowOverdraft,
        newId: () => '',
      });
    } catch (e) {
      if (e instanceof MoneyError) throw badRequest(e.message);
      throw e;
    }
    const common = { userId, type: 'transfer', status: 'posted', transactionDate: b.date, description: b.description, transferGroupId: groupId, transferConversion: built.conversion };
    const [outTx, inTx] = await Transaction.create(
      [
        { ...common, accountId: from._id, direction: 'out', title: `Transfer to ${to.name}`.slice(0, 120), amountMinor: built.out.amountMinor, currency: built.out.currency, idempotencyKey: `${key}:out` },
        { ...common, accountId: to._id, direction: 'in', title: `Transfer from ${from.name}`.slice(0, 120), amountMinor: built.in.amountMinor, currency: built.in.currency, idempotencyKey: `${key}:in` },
      ],
      { session, ordered: true },
    );
    return groupDto(outTx, inTx);
  }).catch((e) => {
    if ((e as { code?: number }).code === 11000) throw conflict('Duplicate transfer');
    throw e;
  });
  res.status(201).json(result);
}));

transfersRouter.get('/', validate({ query: pageQuery }), h(async (req, res) => {
  const { userId } = authed(req);
  const q = req.query as unknown as z.infer<typeof pageQuery>;
  const cur = decodeCursor(q.cursor);
  const filter: Record<string, unknown> = { userId: oid(userId), type: 'transfer', direction: 'out', reversalOf: null, deletedAt: null };
  if (cur) filter.$or = [{ transactionDate: { $lt: cur.d } }, { transactionDate: cur.d, _id: { $lt: oid(cur.i) } }];
  const outs: any[] = await Transaction.find(filter).sort({ transactionDate: -1, _id: -1 }).limit(q.limit + 1).lean();
  const more = outs.length > q.limit;
  const page = more ? outs.slice(0, q.limit) : outs;
  const ins: any[] = await Transaction.find({ userId: oid(userId), type: 'transfer', direction: 'in', reversalOf: null, transferGroupId: { $in: page.map((o) => o.transferGroupId) } }).lean();
  const byGroup = new Map(ins.map((i) => [i.transferGroupId, i]));
  const last = page[page.length - 1];
  res.json({
    items: page.filter((o) => byGroup.has(o.transferGroupId)).map((o) => groupDto(o, byGroup.get(o.transferGroupId))),
    nextCursor: more && last ? encodeCursor(last.transactionDate, last._id) : null,
  });
}));

/** Reverses BOTH legs atomically. */
transfersRouter.post('/:groupId/reverse', idempotent(), validate({ params: z.object({ groupId: z.string().regex(/^[0-9a-f]{24}$/) }) }), h(async (req, res) => {
  const { userId } = authed(req);
  const groupId = req.params.groupId as string;
  await withTransaction(async (session) => {
    const legs: any[] = await Transaction.find({ userId, type: 'transfer', transferGroupId: groupId, reversalOf: null, deletedAt: null }).session(session);
    if (legs.length !== 2) throw notFound('Transfer');
    if (legs.some((l) => l.status !== 'posted')) throw badRequest('Transfer is not in a reversible state');
    for (const l of legs) {
      const [rev] = await Transaction.create(
        [{ userId, accountId: l.accountId, type: 'transfer', direction: l.direction, status: 'posted', title: `Reversal: ${l.title}`.slice(0, 120), amountMinor: l.amountMinor, currency: l.currency, transactionDate: new Date(), transferGroupId: groupId, reversalOf: l._id }],
        { session },
      );
      l.status = 'reversed';
      l.reversedById = rev!._id;
      await l.save({ session });
    }
  }).catch((e) => {
    if ((e as { code?: number }).code === 11000) throw conflict('Transfer is already reversed');
    throw e;
  });
  res.status(201).json({ groupId, status: 'reversed' });
}));
