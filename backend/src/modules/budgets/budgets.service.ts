import { Budget, Category } from '../../database/models/index.js';
import { oid } from '../../database/models/common.js';
import { budgetStatus } from '../../services/finance/ledger.js';
import { totalsFromGroups } from '../../services/finance/aggregate.js';
import { groupsFor } from '../../services/ledger.service.js';
import { zonedMidnight, zonedParts, money } from '../../shared/http.js';

/** Spent = posted expenses (+loan interest, − refunds) in the window. Transfers/savings never count (not 'expense' kind). */
export async function budgetSpent(userId: string, b: any, from = b.startDate as Date, to = b.endDate as Date): Promise<bigint> {
  const match: Record<string, unknown> = { userId: oid(userId), transactionDate: { $gte: from, $lt: to }, type: { $in: ['expense', 'refund', 'loan_interest'] } };
  if (b.categoryIds?.length) match.categoryId = { $in: b.categoryIds };
  return totalsFromGroups(await groupsFor(match)).expenseMinor;
}

export async function budgetDto(userId: string, b: any, withHistory = false) {
  const spent = await budgetSpent(userId, b);
  const budget = BigInt(b.amountMinor);
  const st = budgetStatus(spent, budget, b.warnAtPercent);
  const cats: any[] = b.categoryIds?.length ? await Category.find({ _id: { $in: b.categoryIds } }).select('name').lean() : [];
  const out: Record<string, unknown> = {
    id: String(b._id), name: b.name, period: b.period, currency: b.currency, amount: money(budget, b.currency),
    categoryIds: (b.categoryIds ?? []).map(String), categories: cats.map((c) => ({ id: String(c._id), name: c.name })),
    startDate: b.startDate, endDate: b.endDate, warnAtPercent: b.warnAtPercent, status: b.status,
    spent: money(spent, b.currency), remaining: money(budget - spent, b.currency), percentUsed: st.percentUsed, health: st.status,
  };
  if (withHistory) out.history = await budgetHistory(userId, b);
  return out;
}

/** Previous periods of the same budget (same length, same categories), newest first. */
export async function budgetHistory(userId: string, b: any, n = 6) {
  const lenMs = b.endDate.getTime() - b.startDate.getTime();
  const rows = [];
  for (let i = 1; i <= n; i++) {
    let from: Date;
    let to: Date;
    if (b.period === 'monthly') {
      const p = zonedParts(b.startDate, 'Asia/Colombo');
      from = zonedMidnight(p.y, p.m - i, 1, 'Asia/Colombo');
      to = zonedMidnight(p.y, p.m - i + 1, 1, 'Asia/Colombo');
    } else {
      from = new Date(b.startDate.getTime() - i * lenMs);
      to = new Date(b.endDate.getTime() - i * lenMs);
    }
    const spent = await budgetSpent(userId, b, from, to);
    const st = budgetStatus(spent, BigInt(b.amountMinor), b.warnAtPercent);
    rows.push({ from, to, spent: money(spent, b.currency), percentUsed: st.percentUsed, health: st.status });
  }
  return rows;
}

export function periodWindow(period: 'monthly' | 'weekly' | 'custom', tz: string, o: { month?: number; year?: number; startDate?: Date; endDate?: Date }) {
  if (period === 'monthly') {
    const now = zonedParts(new Date(), tz);
    const y = o.year ?? now.y;
    const m = o.month ?? now.m;
    return { startDate: zonedMidnight(y, m, 1, tz), endDate: zonedMidnight(y, m + 1, 1, tz), month: m, year: y };
  }
  if (period === 'weekly') {
    const p = zonedParts(o.startDate ?? new Date(), tz);
    const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
    return { startDate: zonedMidnight(p.y, p.m, p.d - dow, tz), endDate: zonedMidnight(p.y, p.m, p.d - dow + 7, tz), month: undefined, year: undefined };
  }
  return { startDate: o.startDate!, endDate: o.endDate!, month: undefined, year: undefined };
}
