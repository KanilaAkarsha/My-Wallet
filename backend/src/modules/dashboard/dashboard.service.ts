import { Bill, Budget, Category, Debt, FinancialInsight, SavingsContribution, SavingsGoal, Subscription, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { balanceFromGroups, totalsFromGroups, type Group } from '../../services/finance/aggregate.js';
import { allBalances, groupsFor, periodTotals } from '../../services/ledger.service.js';
import { progressPercent } from '../../services/goals.js';
import { monthlyEquivalentMinor } from '../../services/recurrence.js';
import { cached } from '../../shared/cache.js';
import { money, zonedMidnight, zonedParts } from '../../shared/http.js';
import { budgetDto, budgetSpent } from '../budgets/budgets.service.js';
import { txDto } from '../transactions/transactions.service.js';

const sumBy = (rows: { currency: string; v: bigint }[]) => {
  const m: Record<string, bigint> = {};
  for (const r of rows) m[r.currency] = (m[r.currency] ?? 0n) + r.v;
  return m;
};
const fmt = (m: Record<string, bigint>) => Object.entries(m).map(([currency, v]) => ({ currency, amount: money(v, currency) }));

/** Month buckets (local time) between two instants. */
function months(from: Date, to: Date, tz: string) {
  const f = zonedParts(from, tz);
  const t = zonedParts(new Date(to.getTime() - 1), tz);
  const out: { start: Date; end: Date; label: string }[] = [];
  for (let y = f.y, m = f.m; y < t.y || (y === t.y && m <= t.m); m++) {
    if (m > 12) { m = 1; y++; }
    out.push({ start: zonedMidnight(y, m, 1, tz), end: zonedMidnight(y, m + 1, 1, tz), label: `${y}-${String(m).padStart(2, '0')}` });
    if (out.length > 60) break;
  }
  return out;
}

async function bucketTotals(userId: string, from: Date, to: Date, unit: 'month' | 'day', tz: string, extra: Record<string, unknown> = {}) {
  const rows = await Transaction.aggregate([
    { $match: { userId: oid(userId), transactionDate: { $gte: from, $lt: to }, status: { $in: ['posted', 'reversed'] }, deletedAt: null, ...extra } },
    { $group: { _id: { b: { $dateToString: { date: '$transactionDate', timezone: tz, format: unit === 'month' ? '%Y-%m' : '%Y-%m-%d' } }, kind: '$type', direction: { $ifNull: ['$direction', null] }, reversal: { $cond: [{ $ifNull: ['$reversalOf', false] }, true, false] } }, sum: { $sum: '$amountMinor' } } },
  ]).exec();
  const byB = new Map<string, Group[]>();
  for (const r of rows as any[]) {
    const arr = byB.get(r._id.b) ?? [];
    arr.push({ kind: r._id.kind, direction: r._id.direction, reversal: r._id.reversal, sumMinor: BigInt(String(r.sum)) });
    byB.set(r._id.b, arr);
  }
  return byB;
}

export async function dashboardSummary(userId: string, range: { from: Date; to: Date }, tz: string, currency: string) {
  const balances = await allBalances(userId); // authoritative, never cached
  const totalsBalance: Record<string, bigint> = {};
  for (const { account, balanceMinor } of balances.values()) totalsBalance[account.currency] = (totalsBalance[account.currency] ?? 0n) + balanceMinor;

  const t = await periodTotals(userId, range.from, range.to);
  const now = new Date();

  const goals: any[] = await SavingsGoal.find({ userId, deletedAt: null, status: { $ne: 'archived' } }).lean();
  const savings = sumBy(goals.map((g) => ({ currency: g.currency, v: BigInt(g.currentMinor) })));

  const debts: any[] = await Debt.find({ userId, deletedAt: null, status: 'active' }).lean();
  const debtTotals = sumBy(debts.filter((d) => d.kind !== 'lent').map((d) => ({ currency: d.currency, v: BigInt(d.outstandingPrincipalMinor) + BigInt(d.accruedInterestMinor ?? 0) })));

  const activeBudgets: any[] = await Budget.find({ userId, deletedAt: null, status: 'active', startDate: { $lte: now }, endDate: { $gt: now } }).lean();
  const budgetDtos: any[] = await Promise.all(activeBudgets.map((b) => budgetDto(userId, b)));
  // Remaining is computed from exact minor units (never from formatted strings).
  const remaining: Record<string, bigint> = {};
  for (const b of activeBudgets) remaining[b.currency] = (remaining[b.currency] ?? 0n) + (BigInt(b.amountMinor) - (await budgetSpent(userId, b)));

  const recent: any[] = await Transaction.find({ userId, deletedAt: null }).sort({ transactionDate: -1, _id: -1 }).limit(6).lean();
  const bills: any[] = await Bill.find({ userId, deletedAt: null, status: 'active' }).sort({ nextDueDate: 1 }).limit(5).lean();
  const subs: any[] = await Subscription.find({ userId, deletedAt: null, status: 'active' }).lean();
  const subMonthly = sumBy(subs.map((s) => ({ currency: s.currency, v: monthlyEquivalentMinor(BigInt(s.amountMinor), s.billingFrequency) })));
  const insights: any[] = await FinancialInsight.find({ userId, dismissedAt: null }).sort({ createdAt: -1 }).limit(3).lean();

  const charts = await cached(userId, `charts:${range.from.getTime()}:${range.to.getTime()}:${tz}`, 60, async () => {
    // Income vs expenses, last 6 months ending now.
    const nowP = zonedParts(now, tz);
    const m0 = zonedMidnight(nowP.y, nowP.m - 5, 1, tz);
    const m1 = zonedMidnight(nowP.y, nowP.m + 1, 1, tz);
    const monthly = await bucketTotals(userId, m0, m1, 'month', tz);
    const incomeVsExpenses = months(m0, m1, tz).map((m) => { const x = totalsFromGroups(monthly.get(m.label) ?? []); return { month: m.label, income: money(x.incomeMinor, currency), expenses: money(x.expenseMinor, currency) }; });

    // Daily expense trend in range.
    const daily = await bucketTotals(userId, range.from, range.to, 'day', tz, { type: { $in: ['expense', 'refund', 'loan_interest'] } });
    const dailyTrend: { date: string; expenses: string | null }[] = [];
    for (let d = range.from.getTime(), i = 0; d < range.to.getTime() && i < 400; i++) {
      const p = zonedParts(new Date(d), tz);
      const label = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
      dailyTrend.push({ date: label, expenses: money(totalsFromGroups(daily.get(label) ?? []).expenseMinor, currency) });
      d = zonedMidnight(p.y, p.m, p.d + 1, tz).getTime();
    }

    // Spending by category in range.
    const catRows = await Transaction.aggregate([
      { $match: { userId: oid(userId), transactionDate: { $gte: range.from, $lt: range.to }, status: { $in: ['posted', 'reversed'] }, deletedAt: null, type: { $in: ['expense', 'refund'] } } },
      { $group: { _id: { c: '$categoryId', kind: '$type', reversal: { $cond: [{ $ifNull: ['$reversalOf', false] }, true, false] } }, sum: { $sum: '$amountMinor' } } },
    ]).exec();
    const perCat = new Map<string, bigint>();
    for (const r of catRows as any[]) {
      const sign = (r._id.kind === 'refund' ? -1n : 1n) * (r._id.reversal ? -1n : 1n);
      const k = r._id.c ? String(r._id.c) : 'none';
      perCat.set(k, (perCat.get(k) ?? 0n) + sign * BigInt(String(r.sum)));
    }
    const catDocs: any[] = await Category.find({ _id: { $in: [...perCat.keys()].filter((k) => k !== 'none') } }).select('name color').lean();
    const names = new Map(catDocs.map((c) => [String(c._id), c]));
    const spendingByCategory = [...perCat.entries()].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1)).map(([k, v]) => ({ categoryId: k === 'none' ? null : k, name: names.get(k)?.name ?? 'Uncategorised', color: names.get(k)?.color ?? null, amount: money(v, currency) }));

    // Balance history (month-end, primary currency): openings + cumulative net effect.
    const primary = [...balances.values()].filter((b) => b.account.currency === currency);
    const opening = primary.reduce((s, b) => s + BigInt(b.account.openingBalanceMinor), 0n);
    const ids = primary.map((b) => b.account._id);
    const first: any = await Transaction.findOne({ userId, accountId: { $in: ids }, deletedAt: null }).sort({ transactionDate: 1 }).select('transactionDate').lean();
    const hist: { month: string; balance: string | null }[] = [];
    if (first) {
      const start = zonedMidnight(zonedParts(first.transactionDate, tz).y, zonedParts(first.transactionDate, tz).m, 1, tz);
      const lo = start.getTime() < m0.getTime() - 400 * 86_400_000 ? m0 : start; // cap history window
      const before = await groupsFor({ userId: oid(userId), accountId: { $in: ids }, transactionDate: { $lt: lo } });
      let run = balanceFromGroups(opening, before);
      const byM = await bucketTotalsEffect(userId, ids, lo, m1, tz);
      for (const m of months(lo, m1, tz)) { run = balanceFromGroups(run, byM.get(m.label) ?? []); hist.push({ month: m.label, balance: money(run, currency) }); }
    }

    // Savings growth: cumulative net goal flows by month.
    const flows: any[] = await SavingsContribution.find({ userId, date: { $gte: m0, $lt: m1 } }).select('date direction amountMinor currency').lean();
    const sm = new Map<string, bigint>();
    for (const f of flows.filter((x) => x.currency === currency)) {
      const p = zonedParts(f.date, tz);
      const k = `${p.y}-${String(p.m).padStart(2, '0')}`;
      sm.set(k, (sm.get(k) ?? 0n) + (f.direction === 'contribution' ? 1n : -1n) * BigInt(f.amountMinor));
    }
    const savingsGrowth = months(m0, m1, tz).map((m) => ({ month: m.label, net: money(sm.get(m.label) ?? 0n, currency) }));
    return { incomeVsExpenses, dailyTrend, spendingByCategory, balanceHistory: hist, savingsGrowth };
  });

  const savingsRate = t.incomeMinor > 0n ? Number(((t.incomeMinor - t.expenseMinor) * 100n) / t.incomeMinor) : null;
  return {
    range: { from: range.from, to: range.to },
    currency,
    balance: { total: fmt(totalsBalance), accounts: [...balances.values()].map(({ account, balanceMinor }) => ({ id: String(account._id), name: account.name, hidden: !!account.hidden, currency: account.currency, balance: money(balanceMinor, account.currency) })) },
    kpis: {
      totalIncome: money(t.incomeMinor, currency), totalExpenses: money(t.expenseMinor, currency), netCashFlow: money(t.netMinor, currency),
      savings: fmt(savings), budgetRemaining: fmt(remaining), outstandingDebt: fmt(debtTotals), savingsRatePercent: savingsRate,
    },
    charts,
    recentTransactions: recent.map(txDto),
    upcomingBills: bills.map((b) => ({ id: String(b._id), name: b.name, dueDate: b.nextDueDate, expectedAmount: money(BigInt(b.expectedAmountMinor), b.currency) })),
    budgetProgress: budgetDtos.slice(0, 5),
    goals: goals.slice(0, 4).map((g) => ({ id: String(g._id), name: g.name, current: money(BigInt(g.currentMinor), g.currency), target: money(BigInt(g.targetMinor), g.currency), progressPercent: progressPercent(BigInt(g.currentMinor), BigInt(g.targetMinor)) })),
    insights: insights.map((i) => ({ id: String(i._id), severity: i.severity, headline: i.headline })),
    subscriptionSummary: { activeCount: subs.length, monthly: fmt(subMonthly) },
  };
}

async function bucketTotalsEffect(userId: string, accountIds: unknown[], from: Date, to: Date, tz: string) {
  const rows = await Transaction.aggregate([
    { $match: { userId: oid(userId), accountId: { $in: accountIds }, transactionDate: { $gte: from, $lt: to }, status: { $in: ['posted', 'reversed'] }, deletedAt: null } },
    { $group: { _id: { b: { $dateToString: { date: '$transactionDate', timezone: tz, format: '%Y-%m' } }, kind: '$type', direction: { $ifNull: ['$direction', null] }, reversal: { $cond: [{ $ifNull: ['$reversalOf', false] }, true, false] } }, sum: { $sum: '$amountMinor' } } },
  ]).exec();
  const m = new Map<string, Group[]>();
  for (const r of rows as any[]) {
    const a = m.get(r._id.b) ?? [];
    a.push({ kind: r._id.kind, direction: r._id.direction, reversal: r._id.reversal, sumMinor: BigInt(String(r.sum)) });
    m.set(r._id.b, a);
  }
  return m;
}
