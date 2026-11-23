/** Database-facing ledger queries. Accounting semantics come from services/finance (pure). */
import type { ClientSession } from 'mongoose';
import { Account, Profile, Transaction } from '../database/models/index.js';
import { GROUP_STAGE, balanceFromGroups, parseGroupRows, totalsFromGroups, type Group, type RawRow } from './finance/aggregate.js';
import type { PeriodTotals } from './finance/ledger.js';
import { oid } from '../database/models/common.js';

const COUNTED = ['posted', 'reversed'];

export async function groupsFor(match: Record<string, unknown>, extraId: Record<string, unknown> = {}, session?: ClientSession): Promise<(Group & { key: Record<string, unknown> })[]> {
  const rows = (await Transaction.aggregate([{ $match: { ...match, status: { $in: COUNTED }, deletedAt: null } }, GROUP_STAGE(extraId)])
    .session(session ?? null)
    .exec()) as RawRow[];
  const groups = parseGroupRows(rows);
  return groups.map((g, i) => ({ ...g, key: rows[i]!._id }));
}

/** Authoritative balance of one account, computed by the backend from the ledger. Never cached. */
export async function accountBalance(userId: string, account: { _id: unknown; openingBalanceMinor: bigint }, session?: ClientSession): Promise<bigint> {
  const g = await groupsFor({ userId: oid(userId), accountId: account._id }, {}, session);
  return balanceFromGroups(BigInt(account.openingBalanceMinor), g);
}

export async function allBalances(userId: string, includeArchived = false): Promise<Map<string, { account: any; balanceMinor: bigint }>> {
  const accounts: any[] = await Account.find({ userId, deletedAt: null, ...(includeArchived ? {} : { status: "active" }) }).lean();
  const rows = (await Transaction.aggregate([
    { $match: { userId: oid(userId), status: { $in: COUNTED }, deletedAt: null } },
    GROUP_STAGE({ accountId: '$accountId' }),
  ]).exec()) as (RawRow & { _id: { accountId: unknown } })[];
  const byAcc = new Map<string, Group[]>();
  for (const r of rows) {
    const k = String(r._id.accountId);
    const arr = byAcc.get(k) ?? [];
    arr.push(...parseGroupRows([r]));
    byAcc.set(k, arr);
  }
  const out = new Map<string, { account: any; balanceMinor: bigint }>();
  for (const a of accounts) out.set(String(a._id), { account: a, balanceMinor: balanceFromGroups(BigInt(a.openingBalanceMinor), byAcc.get(String(a._id)) ?? []) });
  return out;
}

export async function periodTotals(userId: string, from: Date, to: Date, filter: Record<string, unknown> = {}): Promise<PeriodTotals> {
  const g = await groupsFor({ userId: oid(userId), transactionDate: { $gte: from, $lt: to }, ...filter });
  return totalsFromGroups(g);
}

export async function userProfile(userId: string) {
  const p = await Profile.findOne({ userId }).lean();
  return { currency: (p?.currency as string) ?? 'LKR', timezone: (p?.timezone as string) ?? 'Asia/Colombo', profile: p };
}
