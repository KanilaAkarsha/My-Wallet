import { Router } from 'express';
import { z } from 'zod';
import { Account, Debt, DebtPayment, Transaction } from '../../database/models/index.js';
import { withTransaction } from '../../database/connection.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { accrueSimpleInterest, allocateDebtPayment } from '../../services/finance/debt.js';
import { MoneyError } from '../../services/finance/money.js';
import { userProfile } from '../../services/ledger.service.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { decimal, h, idParams, isoDate, money, objectId, toMinor } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';

const kinds = ['personal_loan', 'borrowed', 'lent', 'credit_card', 'student_loan', 'installment'] as const;
const isReceivable = (k: string) => k === 'lent';
const create = z.object({
  kind: z.enum(kinds),
  counterparty: z.string().trim().min(1).max(100),
  principal: decimal,
  interestRatePercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).default('0'), // annual %, 2dp -> basis points
  interestMethod: z.enum(['none', 'simple', 'reducing_balance']).default('none'),
  paymentFrequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly', 'one_time']).default('monthly'),
  startDate: isoDate.default(() => new Date()),
  dueDate: isoDate.optional(),
  accountId: objectId.optional(), // where borrowed money landed / lent money came from
  currency: z.string().length(3).optional(),
}).strict();
const payBody = z.object({ amount: decimal, accountId: objectId, date: isoDate.default(() => new Date()) }).strict();

const bps = (pct: string) => Math.round(Number(pct) * 100);
const DAY = 86_400_000;

/** Daily accrual on the outstanding principal (interest never compounds on interest). Idempotent: advances interestAccruedThrough. */
function accrueInto(d: any, through: Date) {
  if (d.interestMethod === 'none' || !d.interestRateBps || d.status !== 'active') {
    d.interestAccruedThrough = through;
    return 0n;
  }
  const from: Date = d.interestAccruedThrough ?? d.startDate;
  const days = Math.floor((through.getTime() - from.getTime()) / DAY);
  if (days <= 0) return 0n;
  const add = accrueSimpleInterest(BigInt(d.outstandingPrincipalMinor), BigInt(d.interestRateBps), days);
  d.accruedInterestMinor = BigInt(d.accruedInterestMinor ?? 0) + add;
  d.interestAccruedThrough = new Date(from.getTime() + days * DAY);
  return add;
}

function dto(d: any, payments?: any[]) {
  const orig = BigInt(d.originalPrincipalMinor);
  const out = BigInt(d.outstandingPrincipalMinor);
  const accrued = BigInt(d.accruedInterestMinor ?? 0);
  return {
    id: String(d._id), kind: d.kind, direction: isReceivable(d.kind) ? 'receivable' : 'liability', counterparty: d.counterparty, currency: d.currency,
    originalPrincipal: money(orig, d.currency), outstandingPrincipal: money(out, d.currency), accruedInterest: money(accrued, d.currency), totalOwed: money(out + accrued, d.currency),
    interestRatePercent: (d.interestRateBps / 100).toFixed(2), interestMethod: d.interestMethod, paymentFrequency: d.paymentFrequency,
    startDate: d.startDate, dueDate: d.dueDate ?? null, status: d.status,
    repaidPercent: orig > 0n ? Number(((orig - out) * 100n) / orig) : 0,
    ...(payments ? { payments: payments.map((p) => ({ id: String(p._id), date: p.date, total: money(BigInt(p.totalMinor), p.currency), principal: money(BigInt(p.principalMinor), p.currency), interest: money(BigInt(p.interestMinor), p.currency) })) } : {}),
  };
}

export const debtsRouter = Router();
debtsRouter.use(requireAuth);

debtsRouter.get('/', validate({ query: z.object({ status: z.enum(['active', 'paid_off', 'archived']).optional() }) }), h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await Debt.find({ userId, deletedAt: null, ...(req.query.status ? { status: req.query.status } : { status: { $ne: 'archived' } }) }).sort({ dueDate: 1, createdAt: -1 }).lean();
  const liabilities: Record<string, bigint> = {};
  const receivables: Record<string, bigint> = {};
  for (const d of rows.filter((x) => x.status === 'active')) {
    const t = isReceivable(d.kind) ? receivables : liabilities;
    t[d.currency] = (t[d.currency] ?? 0n) + BigInt(d.outstandingPrincipalMinor) + BigInt(d.accruedInterestMinor ?? 0);
  }
  const fmt = (o: Record<string, bigint>) => Object.entries(o).map(([currency, v]) => ({ currency, total: money(v, currency) }));
  res.json({ debts: rows.map((d) => dto(d)), outstandingLiabilities: fmt(liabilities), outstandingReceivables: fmt(receivables) });
}));

/**
 * Creating a debt never records income. If `accountId` is given, the cash movement is an
 * ADJUSTMENT (borrowed money lands in the account; lent money leaves it) tagged with the debt.
 */
debtsRouter.post('/', idempotent(), validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof create>;
  const currency = (b.currency ?? (await userProfile(userId)).currency).toUpperCase();
  const principal = toMinor(b.principal, currency);
  if (principal <= 0n) throw badRequest('Principal must be greater than zero');
  if (b.interestMethod === 'none' && bps(b.interestRatePercent) > 0) throw badRequest('Choose an interest method or set the rate to 0');
  const out = await withTransaction(async (session) => {
    const [debt] = await Debt.create([{ userId, kind: b.kind, counterparty: b.counterparty, currency, originalPrincipalMinor: principal, outstandingPrincipalMinor: principal, interestRateBps: bps(b.interestRatePercent), interestMethod: b.interestMethod, paymentFrequency: b.paymentFrequency, startDate: b.startDate, dueDate: b.dueDate, interestAccruedThrough: b.startDate }], { session });
    if (b.accountId && b.kind !== 'credit_card') {
      const a: any = await Account.findOne({ _id: b.accountId, userId, deletedAt: null, status: 'active' }).session(session);
      if (!a) throw notFound('Account');
      if (a.currency !== currency) throw badRequest('Account currency must match the debt currency');
      await Transaction.create([{ userId, accountId: a._id, type: 'adjustment', direction: isReceivable(b.kind) ? 'out' : 'in', status: 'posted', title: `${isReceivable(b.kind) ? 'Loan given to' : 'Loan received from'} ${b.counterparty}`.slice(0, 120), amountMinor: principal, currency, transactionDate: b.startDate, debtId: debt!._id }], { session });
    }
    return debt!;
  });
  res.status(201).json(dto(out));
}));

debtsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const d = await findOwned(Debt, userId, req.params.id, 'Debt', { deletedAt: null });
  const pays: any[] = await DebtPayment.find({ userId, debtId: d._id }).sort({ date: -1 }).limit(200).lean();
  res.json(dto(d, pays));
}));

debtsRouter.patch('/:id', validate({ params: idParams, body: z.object({ counterparty: z.string().trim().min(1).max(100), dueDate: isoDate.nullable(), paymentFrequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly', 'one_time']) }).partial().strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const d = await findOwned(Debt, userId, req.params.id, 'Debt', { deletedAt: null });
  const b = req.body;
  if (b.counterparty) d.counterparty = b.counterparty;
  if (b.dueDate !== undefined) d.dueDate = b.dueDate ?? undefined;
  if (b.paymentFrequency) d.paymentFrequency = b.paymentFrequency;
  await d.save();
  res.json(dto(d));
}));

debtsRouter.post('/:id/accrue', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const d = await findOwned(Debt, userId, req.params.id, 'Debt', { deletedAt: null });
  const added = accrueInto(d, new Date());
  await d.save();
  res.json({ added: money(added, d.currency), debt: dto(d) });
}));

/**
 * Payment: interest first, remainder reduces principal.
 *  liability -> interest is an EXPENSE (loan_interest); principal is a balance movement (adjustment), NOT an expense.
 *  receivable -> interest received is income; principal received is a balance movement.
 * Everything commits atomically; the idempotency key blocks double-submits.
 */
debtsRouter.post('/:id/payments', idempotent({ required: true }), validate({ params: idParams, body: payBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof payBody>;
  const key = req.header('idempotency-key')!;
  const result = await withTransaction(async (session) => {
    const d: any = await Debt.findOne({ _id: req.params.id, userId, deletedAt: null }).session(session);
    if (!d) throw notFound('Debt');
    if (d.status !== 'active') throw badRequest('This debt is not active');
    const acc: any = await Account.findOne({ _id: b.accountId, userId, deletedAt: null, status: 'active' }).session(session);
    if (!acc) throw notFound('Account');
    if (acc.currency !== d.currency) throw badRequest('Account currency must match the debt currency');
    accrueInto(d, b.date);
    let alloc;
    try {
      alloc = allocateDebtPayment({ outstandingPrincipalMinor: BigInt(d.outstandingPrincipalMinor), accruedInterestMinor: BigInt(d.accruedInterestMinor ?? 0), paymentMinor: toMinor(b.amount, d.currency) });
    } catch (e) {
      if (e instanceof MoneyError) throw badRequest(e.message);
      throw e;
    }
    const rec = isReceivable(d.kind);
    const base = { userId, accountId: acc._id, status: 'posted', currency: d.currency, transactionDate: b.date, debtId: d._id };
    let interestTxId;
    if (alloc.interestMinor > 0n) {
      const [t] = await Transaction.create([{ ...base, type: rec ? 'income' : 'loan_interest', title: `${rec ? 'Interest received from' : 'Loan interest to'} ${d.counterparty}`.slice(0, 120), amountMinor: alloc.interestMinor, idempotencyKey: `${key}:int` }], { session });
      interestTxId = t!._id;
    }
    if (alloc.principalMinor > 0n) {
      await Transaction.create([{ ...base, type: 'adjustment', direction: rec ? 'in' : 'out', title: `${rec ? 'Repayment received from' : 'Loan repayment to'} ${d.counterparty}`.slice(0, 120), amountMinor: alloc.principalMinor, idempotencyKey: `${key}:pri` }], { session });
    }
    const [pay] = await DebtPayment.create([{ userId, debtId: d._id, accountId: acc._id, date: b.date, totalMinor: alloc.interestMinor + alloc.principalMinor, principalMinor: alloc.principalMinor, interestMinor: alloc.interestMinor, currency: d.currency, interestTransactionId: interestTxId, idempotencyKey: key }], { session });
    d.outstandingPrincipalMinor = alloc.newOutstandingPrincipalMinor;
    d.accruedInterestMinor = alloc.newAccruedInterestMinor;
    if (alloc.newOutstandingPrincipalMinor === 0n && alloc.newAccruedInterestMinor === 0n) d.status = 'paid_off';
    await d.save({ session });
    return { payment: pay!, debt: d };
  }).catch((e) => {
    if ((e as { code?: number }).code === 11000) throw conflict('Duplicate payment');
    throw e;
  });
  res.status(201).json({ paymentId: String(result.payment._id), debt: dto(result.debt) });
}));

debtsRouter.post('/:id/archive', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const d = await findOwned(Debt, userId, req.params.id, 'Debt', { deletedAt: null });
  d.status = 'archived';
  await d.save();
  res.json(dto(d));
}));
