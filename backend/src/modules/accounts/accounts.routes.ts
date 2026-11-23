import { Router } from 'express';
import { z } from 'zod';
import { Account, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { enforceLimit } from '../billing/limits.js';
import { reconcile } from '../../services/finance/ledger.js';
import { accountBalance, allBalances, userProfile } from '../../services/ledger.service.js';
import { conflict } from '../../shared/errors.js';
import { currencyCode, h, idParams, isoDate, money, signedDecimal, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { isSupportedCurrency } from '../../services/finance/money.js';
import { badRequest } from '../../shared/errors.js';

const types = ['cash', 'savings', 'current', 'bank', 'ewallet', 'other'] as const;
const createBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(types),
    currency: currencyCode.optional(),
    openingBalance: signedDecimal.default('0'),
    notes: z.string().max(500).optional(),
    hidden: z.boolean().optional(),
  })
  .strict();
const updateBody = z.object({ name: z.string().trim().min(1).max(80), notes: z.string().max(500).nullable(), hidden: z.boolean(), type: z.enum(types) }).partial().strict();

export const dto = (a: any, balanceMinor?: bigint) => ({
  id: String(a._id),
  name: a.name,
  type: a.type,
  currency: a.currency,
  openingBalance: money(BigInt(a.openingBalanceMinor), a.currency),
  ...(balanceMinor !== undefined ? { balance: money(balanceMinor, a.currency), balanceMinor: balanceMinor.toString() } : {}),
  notes: a.notes ?? null,
  hidden: !!a.hidden,
  status: a.status,
  lastReconciledAt: a.lastReconciledAt ?? null,
  createdAt: a.createdAt,
});

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get('/', validate({ query: z.object({ includeArchived: z.enum(['true', 'false']).default('false') }) }), h(async (req, res) => {
  const { userId } = authed(req);
  const map = await allBalances(userId, req.query.includeArchived === 'true');
  const accounts = [...map.values()].map(({ account, balanceMinor }) => dto(account, balanceMinor)).sort((a, b) => a.name.localeCompare(b.name));
  // Totals are per currency: balances in different currencies are never added together.
  const totals: Record<string, bigint> = {};
  for (const { account, balanceMinor } of map.values()) if (!account.hidden) totals[account.currency] = (totals[account.currency] ?? 0n) + balanceMinor;
  res.json({ accounts, totals: Object.entries(totals).map(([currency, v]) => ({ currency, total: money(v, currency) })) });
}));

accountsRouter.post('/', enforceLimit('accounts', Account, { status: 'active' }), validate({ body: createBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof createBody>;
  const currency = b.currency ?? (await userProfile(userId)).currency;
  if (!isSupportedCurrency(currency)) throw badRequest('Unsupported currency');
  try {
    const a = await Account.create({
      userId, name: b.name, type: b.type, currency, openingBalanceMinor: toMinor(b.openingBalance, currency), notes: b.notes, hidden: b.hidden ?? false,
    });
    res.status(201).json(dto(a, BigInt(a.openingBalanceMinor)));
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('You already have an account with this name');
    throw e;
  }
}));

accountsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Account, userId, req.params.id, 'Account', { deletedAt: null });
  res.json(dto(a, await accountBalance(userId, a)));
}));

accountsRouter.patch('/:id', validate({ params: idParams, body: updateBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Account, userId, req.params.id, 'Account', { deletedAt: null });
  Object.assign(a, req.body);
  await a.save();
  res.json(dto(a, await accountBalance(userId, a)));
}));

/** Archive keeps all history. Hard deletion of accounts is intentionally unsupported. */
accountsRouter.post('/:id/archive', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Account, userId, req.params.id, 'Account', { deletedAt: null });
  a.status = 'archived';
  await a.save();
  res.json(dto(a, await accountBalance(userId, a)));
}));
accountsRouter.post('/:id/unarchive', validate({ params: idParams }), enforceLimit('accounts', Account, { status: 'active' }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Account, userId, req.params.id, 'Account', { deletedAt: null });
  a.status = 'active';
  await a.save();
  res.json(dto(a, await accountBalance(userId, a)));
}));

/** Reconciliation: compare computed balance with a statement balance; reports the discrepancy. */
accountsRouter.post('/:id/reconcile', validate({ params: idParams, body: z.object({ statementBalance: signedDecimal, asOf: isoDate.optional() }).strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Account, userId, req.params.id, 'Account', { deletedAt: null });
  const statementMinor = toMinor(req.body.statementBalance, a.currency);
  const computed = await accountBalance(userId, a);
  const r = reconcile({ openingBalanceMinor: computed, currency: a.currency, entries: [], statementBalanceMinor: statementMinor });
  const pending = await Transaction.countDocuments({ userId: oid(userId), accountId: a._id, status: 'pending', deletedAt: null });
  if (r.reconciled) {
    a.lastReconciledAt = new Date();
    a.lastStatementBalanceMinor = statementMinor;
    await a.save();
  }
  res.json({
    reconciled: r.reconciled,
    computedBalance: money(r.computedMinor, a.currency),
    statementBalance: money(statementMinor, a.currency),
    difference: money(r.differenceMinor, a.currency),
    pendingTransactions: pending,
    hint: r.reconciled ? null : 'Check for missing, duplicated or pending transactions, or record an adjustment for the difference.',
  });
}));
