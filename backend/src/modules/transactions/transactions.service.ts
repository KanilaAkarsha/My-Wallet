import { Types } from 'mongoose';
import { Account, Category, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { withTransaction } from '../../database/connection.js';
import { buildRefund, type LedgerEntry } from '../../services/finance/ledger.js';
import { MoneyError } from '../../services/finance/money.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { money } from '../../shared/http.js';
import { assertObjectId, findOwned } from '../../shared/ownership.js';

export const txDto = (t: any) => ({
  id: String(t._id),
  type: t.type,
  direction: t.direction ?? null,
  status: t.status,
  title: t.title,
  amount: money(BigInt(t.amountMinor), t.currency),
  currency: t.currency,
  accountId: String(t.accountId),
  categoryId: t.categoryId ? String(t.categoryId) : null,
  date: t.transactionDate,
  description: t.description ?? null,
  notes: t.notes ?? null,
  tags: t.tags ?? [],
  attachmentIds: (t.attachmentIds ?? []).map(String),
  transferGroupId: t.transferGroupId ?? null,
  reversalOf: t.reversalOf ? String(t.reversalOf) : null,
  reversedById: t.reversedById ? String(t.reversedById) : null,
  refundOf: t.refundOf ? String(t.refundOf) : null,
  debtId: t.debtId ? String(t.debtId) : null,
  createdAt: t.createdAt,
  postedAt: t.postedAt ?? null,
});

/** A category is usable if it is a system category or belongs to this user, and matches the transaction direction. */
export async function assertCategory(userId: string, categoryId: string | undefined | null, kind: 'income' | 'expense') {
  if (!categoryId) return;
  assertObjectId(categoryId, 'Category');
  const c = await Category.findOne({ _id: categoryId, $or: [{ userId: null }, { userId }], archivedAt: null }).lean();
  if (!c) throw notFound('Category');
  if (c.kind !== kind) throw badRequest(`Category is an ${c.kind} category`);
}

export async function loadActiveAccount(userId: string, accountId: string) {
  const a = await findOwned(Account, userId, accountId, 'Account', { deletedAt: null });
  if (a.status !== 'active') throw badRequest('Account is archived');
  return a;
}

export interface CreateInput {
  type: 'income' | 'expense' | 'refund' | 'adjustment';
  title: string;
  amountMinor: bigint;
  accountId: string;
  categoryId?: string;
  date: Date;
  description?: string;
  notes?: string;
  tags?: string[];
  status: 'pending' | 'posted';
  direction?: 'in' | 'out';
  refundOf?: string;
  idempotencyKey?: string;
  currency?: string;
}

export async function createTransaction(userId: string, i: CreateInput) {
  const account = await loadActiveAccount(userId, i.accountId);
  if (i.currency && i.currency !== account.currency) throw badRequest(`Account currency is ${account.currency}; record transfers with a conversion rate for other currencies`);
  if (i.type === 'adjustment' && !i.direction) throw badRequest('Adjustments need a direction');
  if (i.type !== 'adjustment' && i.direction) throw badRequest('direction is only valid for adjustments');
  if (i.type === 'income' || i.type === 'expense' || i.type === 'refund') await assertCategory(userId, i.categoryId, i.type === 'income' ? 'income' : 'expense');

  const base: Record<string, unknown> = {
    userId, accountId: account._id, type: i.type, status: i.status, title: i.title, amountMinor: i.amountMinor, currency: account.currency,
    categoryId: i.categoryId, transactionDate: i.date, description: i.description, notes: i.notes, tags: i.tags ?? [], direction: i.direction, idempotencyKey: i.idempotencyKey,
  };

  if (i.type === 'refund') {
    if (i.status !== 'posted') throw badRequest('Refunds are recorded as posted');
    if (!i.refundOf) throw badRequest('refundOf (the original expense id) is required');
    const original: any = await findOwned(Transaction, userId, i.refundOf, 'Original expense', { deletedAt: null });
    if (String(original.accountId) !== String(account._id)) throw badRequest('Refund must credit the original expense’s account');
    const existing = await Transaction.find({ userId, refundOf: original._id, deletedAt: null }).lean();
    const toEntry = (t: any): LedgerEntry => ({ id: String(t._id), accountId: String(t.accountId), kind: t.type, status: t.status, amountMinor: BigInt(t.amountMinor), currency: t.currency, date: t.transactionDate, reversalOf: t.reversalOf ? String(t.reversalOf) : undefined, refundOf: t.refundOf ? String(t.refundOf) : undefined });
    try {
      buildRefund({ original: toEntry(original), existingRefunds: existing.map(toEntry), amountMinor: i.amountMinor, date: i.date, newId: () => 'tmp' });
    } catch (e) {
      if (e instanceof MoneyError) throw badRequest(e.message);
      throw e;
    }
    base.refundOf = original._id;
    base.categoryId = base.categoryId ?? original.categoryId;
  }

  try {
    return await Transaction.create(base);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('Duplicate request');
    throw e;
  }
}

/**
 * Reversal: appends an offsetting entry and marks the original `reversed`. History is preserved.
 * Both writes commit atomically. A second reversal of the same entry hits the unique index.
 */
export async function reverseTransaction(userId: string, id: string, reason?: string) {
  const orig: any = await findOwned(Transaction, userId, id, 'Transaction', { deletedAt: null });
  if (orig.status !== 'posted') throw badRequest('Only posted transactions can be reversed');
  if (orig.reversalOf) throw badRequest('A reversal cannot be reversed');
  if (orig.type === 'transfer') throw badRequest('Reverse transfers from the transfers page so both sides are reversed together');
  if (orig.type === 'loan_interest' || orig.debtId) throw badRequest('Debt payments are corrected from the debt page');
  return withTransaction(async (session) => {
    const [rev] = await Transaction.create(
      [{
        userId: orig.userId, accountId: orig.accountId, type: orig.type, direction: orig.direction, status: 'posted',
        title: `Reversal: ${orig.title}`.slice(0, 120), amountMinor: orig.amountMinor, currency: orig.currency, categoryId: orig.categoryId,
        transactionDate: new Date(), notes: reason, reversalOf: orig._id, refundOf: orig.refundOf,
      }],
      { session },
    );
    const fresh: any = await Transaction.findById(orig._id).session(session);
    fresh.status = 'reversed';
    fresh.reversedById = rev!._id;
    await fresh.save({ session });
    return { original: fresh, reversal: rev! };
  }).catch((e) => {
    if ((e as { code?: number }).code === 11000) throw conflict('Transaction is already reversed');
    throw e;
  });
}

export const objectIdOf = (s: string) => new Types.ObjectId(s);
export { oid };
