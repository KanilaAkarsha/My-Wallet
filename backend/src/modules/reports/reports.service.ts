import { Account, Budget, Category, Debt, SavingsContribution, SavingsGoal, Subscription, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { balanceFromGroups, totalsFromGroups, type Group } from '../../services/finance/aggregate.js';
import { allBalances, groupsFor, userProfile } from '../../services/ledger.service.js';
import { monthlyEquivalentMinor } from '../../services/recurrence.js';
import { money, zonedMidnight, zonedParts } from '../../shared/http.js';
import { budgetDto } from '../budgets/budgets.service.js';
import type { Table } from './export.js';

export const REPORT_NAMES = ['monthly-income', 'monthly-expenses', 'annual', 'spending-by-category', 'account-balances', 'savings-progress', 'budget-performance', 'debt-repayment', 'subscription-spending', 'cash-flow', 'income-sources'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
export const ADVANCED: ReadonlySet<ReportName> = new Set(['budget-performance', 'debt-repayment', 'cash-flow', 'income-sources', 'subscription-spending']);

async function monthlyBuckets(userId: string, from: Date, to: Date, tz: string, extra: Record<string, unknown> = {}) {
  const rows = (await Transaction.aggregate([
    { $match: { userId: oid(userId), transactionDate: { $gte: from, $lt: to }, status: { $in: ['posted', 'reversed'] }, deletedAt: null, ...extra } },
    { $group: { _id: { b: { $dateToString: { date: '$transactionDate', timezone: tz, format: '%Y-%m' } }, kind: '$type', direction: { $ifNull: ['$direction', null] }, reversal: { $cond: [{ $ifNull: ['$reversalOf', false] }, true, false] } }, sum: { $sum: '$amountMinor' } } },
  ]).exec()) as any[];
  const m = new Map<string, Group[]>();
  for (const r of rows) m.set(r._id.b, [...(m.get(r._id.b) ?? []), { kind: r._id.kind, direction: r._id.direction, reversal: r._id.reversal, sumMinor: BigInt(String(r.sum)) }]);
  return m;
}
const monthLabels = (from: Date, to: Date, tz: string) => {
  const out: string[] = [];
  const f = zonedParts(from, tz);
  for (let i = 0; i < 120; i++) {
    const d = zonedMidnight(f.y, f.m + i, 1, tz);
    if (d >= to) break;
    const p = zonedParts(d, tz);
    out.push(`${p.y}-${String(p.m).padStart(2, '0')}`);
  }
  return out;
};

export interface ReportParams { from: Date; to: Date; year?: number }

export async function buildReport(userId: string, name: ReportName, q: ReportParams): Promise<Table> {
  const { currency: c, timezone: tz } = await userProfile(userId);
  const period = `${q.from.toISOString().slice(0, 10)} to ${new Date(q.to.getTime() - 1).toISOString().slice(0, 10)}`;
  const subtitle = `Currency: ${c} · Period: ${period} · Posted transactions only; transfers are not income or expenses.`;
  switch (name) {
    case 'monthly-income':
    case 'monthly-expenses': {
      const inc = name === 'monthly-income';
      const b = await monthlyBuckets(userId, q.from, q.to, tz);
      return { title: inc ? 'Monthly income' : 'Monthly expenses', subtitle, columns: ['Month', inc ? 'Income' : 'Expenses'], rows: monthLabels(q.from, q.to, tz).map((m) => { const t = totalsFromGroups(b.get(m) ?? []); return [m, money(inc ? t.incomeMinor : t.expenseMinor, c)!]; }) };
    }
    case 'annual': {
      const rows = new Map<string, Group[]>();
      for (const [m, g] of await monthlyBuckets(userId, q.from, q.to, tz)) rows.set(m.slice(0, 4), [...(rows.get(m.slice(0, 4)) ?? []), ...g]);
      return { title: 'Annual income and expenses', subtitle, columns: ['Year', 'Income', 'Expenses', 'Net'], rows: [...rows].sort().map(([y, g]) => { const t = totalsFromGroups(g); return [y, money(t.incomeMinor, c)!, money(t.expenseMinor, c)!, money(t.netMinor, c)!]; }) };
    }
    case 'cash-flow': {
      const b = await monthlyBuckets(userId, q.from, q.to, tz);
      let run = 0n;
      return { title: 'Cash flow', subtitle, columns: ['Month', 'Income', 'Expenses', 'Net', 'Cumulative net'], rows: monthLabels(q.from, q.to, tz).map((m) => { const t = totalsFromGroups(b.get(m) ?? []); run += t.netMinor; return [m, money(t.incomeMinor, c)!, money(t.expenseMinor, c)!, money(t.netMinor, c)!, money(run, c)!]; }) };
    }
    case 'spending-by-category':
    case 'income-sources': {
      const inc = name === 'income-sources';
      const g = await groupsFor({ userId: oid(userId), transactionDate: { $gte: q.from, $lt: q.to }, type: { $in: inc ? ['income'] : ['expense', 'refund', 'loan_interest'] } }, { c: '$categoryId' });
      const by = new Map<string, Group[]>();
      for (const x of g) by.set(String((x.key as any).c ?? 'none'), [...(by.get(String((x.key as any).c ?? 'none')) ?? []), x]);
      const cats: any[] = await Category.find({ _id: { $in: [...by.keys()].filter((k) => k !== 'none') } }).select('name').lean();
      const nm = new Map(cats.map((x) => [String(x._id), x.name]));
      const vals = [...by].map(([k, v]) => ({ k, v: inc ? totalsFromGroups(v).incomeMinor : totalsFromGroups(v).expenseMinor })).filter((x) => x.v !== 0n).sort((a, b2) => (b2.v > a.v ? 1 : -1));
      const total = vals.reduce((s, x) => s + x.v, 0n);
      return { title: inc ? 'Income by source' : 'Spending by category', subtitle, columns: ['Category', 'Amount', 'Share'], rows: vals.map((x) => [nm.get(x.k) ?? 'Uncategorised', money(x.v, c)!, total > 0n ? `${(Number((x.v * 1000n) / total) / 10).toFixed(1)}%` : '0.0%']) };
    }
    case 'account-balances': {
      const bal = await allBalances(userId, true);
      return { title: 'Account balances', subtitle: 'Computed by MyWallet from your posted transactions.', columns: ['Account', 'Type', 'Currency', 'Balance', 'Status'], rows: [...bal.values()].map(({ account: a, balanceMinor }) => [a.name, a.type, a.currency, money(balanceMinor, a.currency)!, a.status]) };
    }
    case 'savings-progress': {
      const gs: any[] = await SavingsGoal.find({ userId, deletedAt: null }).lean();
      return { title: 'Savings progress', subtitle: 'As of today.', columns: ['Goal', 'Saved', 'Target', 'Progress', 'Status'], rows: gs.map((g) => [g.name, money(BigInt(g.currentMinor), g.currency)!, money(BigInt(g.targetMinor), g.currency)!, `${Number((BigInt(g.currentMinor) * 100n) / BigInt(g.targetMinor))}%`, g.status]) };
    }
    case 'budget-performance': {
      const bs: any[] = await Budget.find({ userId, deletedAt: null, startDate: { $lt: q.to }, endDate: { $gt: q.from } }).sort({ startDate: -1 }).lean();
      const rows = [];
      for (const b of bs) { const d: any = await budgetDto(userId, b); rows.push([b.name, `${b.startDate.toISOString().slice(0, 10)}`, d.amount, d.spent, d.remaining, `${d.percentUsed}%`, d.health]); }
      return { title: 'Budget performance', subtitle, columns: ['Budget', 'Starts', 'Budget', 'Spent', 'Remaining', 'Used', 'Status'], rows };
    }
    case 'debt-repayment': {
      const ds: any[] = await Debt.find({ userId, deletedAt: null }).lean();
      return { title: 'Debt repayment', subtitle: 'As of today.', columns: ['Counterparty', 'Kind', 'Original', 'Outstanding', 'Accrued interest', 'Repaid', 'Status'], rows: ds.map((d) => [d.counterparty, d.kind, money(BigInt(d.originalPrincipalMinor), d.currency)!, money(BigInt(d.outstandingPrincipalMinor), d.currency)!, money(BigInt(d.accruedInterestMinor ?? 0), d.currency)!, `${Number(((BigInt(d.originalPrincipalMinor) - BigInt(d.outstandingPrincipalMinor)) * 100n) / BigInt(d.originalPrincipalMinor))}%`, d.status]) };
    }
    case 'subscription-spending': {
      const ss: any[] = await Subscription.find({ userId, deletedAt: null }).lean();
      return { title: 'Subscription spending', subtitle: 'Equivalents are derived from each plan’s billing frequency.', columns: ['Name', 'Provider', 'Frequency', 'Amount', 'Monthly equivalent', 'Status'], rows: ss.map((s) => [s.name, s.provider ?? '', s.billingFrequency, money(BigInt(s.amountMinor), s.currency)!, money(monthlyEquivalentMinor(BigInt(s.amountMinor), s.billingFrequency), s.currency)!, s.status]) };
    }
  }
}

/** Streams the full ledger in pages so memory stays flat for large histories. */
export async function* transactionCsvRows(userId: string): AsyncGenerator<string[]> {
  yield ['Date', 'Type', 'Status', 'Title', 'Amount', 'Currency', 'Account', 'Category', 'Tags', 'Notes'];
  const accounts: any[] = await Account.find({ userId }).select('name').lean();
  const cats: any[] = await Category.find({ $or: [{ userId: null }, { userId }] }).select('name').lean();
  const an = new Map(accounts.map((a) => [String(a._id), a.name]));
  const cn = new Map(cats.map((a) => [String(a._id), a.name]));
  const cursor = Transaction.find({ userId, deletedAt: null }).sort({ transactionDate: -1, _id: -1 }).lean().cursor({ batchSize: 500 });
  for await (const t of cursor as AsyncIterable<any>) {
    const sign = t.type === 'expense' || t.type === 'loan_interest' || (t.direction === 'out') ? '-' : '';
    yield [t.transactionDate.toISOString().slice(0, 10), t.type, t.status, t.title, `${sign}${money(BigInt(t.amountMinor), t.currency)}`, t.currency, an.get(String(t.accountId)) ?? '', t.categoryId ? cn.get(String(t.categoryId)) ?? '' : '', (t.tags ?? []).join(' '), t.notes ?? ''];
  }
}

export const _x = [SavingsContribution, balanceFromGroups];
