import { Bill, Budget, Category, FinancialInsight, SavingsGoal, Transaction } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { totalsFromGroups } from '../../services/finance/aggregate.js';
import { groupsFor, periodTotals, userProfile } from '../../services/ledger.service.js';
import { zonedMidnight, zonedParts } from '../../shared/http.js';
import { budgetSpent } from '../budgets/budgets.service.js';
import * as R from './rules.js';

async function categorySpend(userId: string, from: Date, to: Date) {
  const g = await groupsFor({ userId: oid(userId), transactionDate: { $gte: from, $lt: to }, type: { $in: ['expense', 'refund'] }, categoryId: { $ne: null } }, { c: '$categoryId' });
  const by = new Map<string, any[]>();
  for (const x of g) { const k = String((x.key as any).c); by.set(k, [...(by.get(k) ?? []), x]); }
  return new Map([...by].map(([k, v]) => [k, totalsFromGroups(v).expenseMinor]));
}

/** Computes insights from real data and stores new ones (unique per rule+period => idempotent). */
export async function computeInsights(userId: string, now = new Date()): Promise<number> {
  const { currency, timezone: tz } = await userProfile(userId);
  const p = zonedParts(now, tz);
  const curStart = zonedMidnight(p.y, p.m, 1, tz);
  const prevStart = zonedMidnight(p.y, p.m - 1, 1, tz);
  const elapsedMs = now.getTime() - curStart.getTime();
  const prevSame = new Date(Math.min(prevStart.getTime() + elapsedMs, curStart.getTime())); // same stretch of last month
  const prevPeriod = { from: prevStart, to: prevSame };
  const curPeriod = { from: curStart, to: now };
  const out: R.Insight[] = [];

  const [curCats, prevCats] = await Promise.all([categorySpend(userId, curStart, now), categorySpend(userId, prevStart, prevSame)]);
  const cats: any[] = await Category.find({ _id: { $in: [...new Set([...curCats.keys(), ...prevCats.keys()])] } }).select('name').lean();
  for (const c of cats) {
    const i = R.categorySpendChange({ category: c.name, categoryId: String(c._id), currency, prev: prevCats.get(String(c._id)) ?? 0n, cur: curCats.get(String(c._id)) ?? 0n, prevPeriod, curPeriod, label: 'so far this month' });
    if (i) out.push(i);
  }

  const budgets: any[] = await Budget.find({ userId, deletedAt: null, status: 'active', startDate: { $lte: now }, endDate: { $gt: now } }).lean();
  for (const b of budgets) {
    const i = R.budgetExceeded({ name: b.name, budgetId: String(b._id), currency: b.currency, spent: await budgetSpent(userId, b), budget: BigInt(b.amountMinor), period: { from: b.startDate, to: b.endDate } });
    if (i) out.push(i);
  }

  // Savings rate: last two COMPLETE months.
  const m1 = { from: prevStart, to: curStart };
  const m2 = { from: zonedMidnight(p.y, p.m - 2, 1, tz), to: prevStart };
  const [t1, t2] = await Promise.all([periodTotals(userId, m1.from, m1.to), periodTotals(userId, m2.from, m2.to)]);
  const sr = R.savingsRateChange({ currency, prevIncome: t2.incomeMinor, prevExpense: t2.expenseMinor, curIncome: t1.incomeMinor, curExpense: t1.expenseMinor, prevPeriod: m2, curPeriod: m1 });
  if (sr) out.push({ ...sr, ruleId: `savings_rate_improved:${m1.from.toISOString().slice(0, 7)}` });

  const bills: any[] = await Bill.find({ userId, deletedAt: null, status: 'active' }).lean();
  for (const b of bills) {
    const i = R.billDueSoon({ name: b.name, billId: String(b._id), due: b.nextDueDate, now, expected: BigInt(b.expectedAmountMinor), currency: b.currency });
    if (i) out.push(i);
  }

  const subSpend = async (from: Date, to: Date) => totalsFromGroups(await groupsFor({ userId: oid(userId), transactionDate: { $gte: from, $lt: to }, subscriptionId: { $ne: null } })).expenseMinor;
  const si = R.subscriptionSpendChange({ currency, prev: await subSpend(m2.from, m2.to), cur: await subSpend(m1.from, m1.to), prevPeriod: m2, curPeriod: m1 });
  if (si) out.push({ ...si, ruleId: `subscription_spend_increase:${m1.from.toISOString().slice(0, 7)}` });

  const goals: any[] = await SavingsGoal.find({ userId, deletedAt: null, status: 'active' }).lean();
  for (const g of goals) {
    const i = R.goalNearlyDone({ name: g.name, goalId: String(g._id), current: BigInt(g.currentMinor), target: BigInt(g.targetMinor), currency: g.currency, now });
    if (i) out.push(i);
  }

  let created = 0;
  for (const i of out) {
    try {
      await FinancialInsight.create({ userId, ruleId: i.ruleId, severity: i.severity, headline: i.headline, what: i.what, period: { from: curStart, to: i.period.to > now ? now : i.period.to }, calculation: i.calculation, why: i.why });
      created++;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // already stored for this period
    }
  }
  return created;
}

export const _t = Transaction;
