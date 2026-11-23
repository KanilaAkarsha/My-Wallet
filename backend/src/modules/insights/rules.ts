/**
 * Rules-based insights. Pure functions over real figures: each returns null unless the data
 * justifies an insight, and always explains what changed, the period, the calculation and why it matters.
 * Nothing here invents numbers; thresholds are explicit constants.
 */
import { formatMajor } from '../../services/finance/money.js';

export interface Insight {
  ruleId: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
  headline: string;
  what: string;
  period: { from: Date; to: Date };
  calculation: string;
  why: string;
}
interface P { from: Date; to: Date }

export const THRESHOLDS = { categoryChangePct: 15, minCategoryMinor: 100_00n, savingsRatePoints: 5, goalClosePct: 90, billSoonDays: 3, subscriptionChangePct: 10 };
const m = (v: bigint, c: string) => `${c} ${formatMajor(v, c)}`;
/** Integer percent change, rounded half away from zero; null when the baseline is zero. */
export function pctChange(prev: bigint, cur: bigint): number | null {
  if (prev <= 0n) return null;
  const d = (cur - prev) * 100n;
  const q = (d < 0n ? -d : d) * 2n + prev;
  const r = q / (prev * 2n);
  return Number(d < 0n ? -r : r);
}

export function categorySpendChange(o: { category: string; categoryId: string; currency: string; prev: bigint; cur: bigint; prevPeriod: P; curPeriod: P; label: string }): Insight | null {
  if (o.prev < THRESHOLDS.minCategoryMinor) return null;
  const pct = pctChange(o.prev, o.cur);
  if (pct === null || Math.abs(pct) < THRESHOLDS.categoryChangePct) return null;
  const up = pct > 0;
  return {
    ruleId: `category_change:${o.categoryId}`,
    severity: up ? 'warning' : 'positive',
    headline: `Your ${o.category.toLowerCase()} spending ${up ? 'increased' : 'decreased'} by ${Math.abs(pct)}%`,
    what: `You spent ${m(o.cur, o.currency)} on ${o.category} ${o.label}, compared with ${m(o.prev, o.currency)} over the same stretch of the previous month.`,
    period: { from: o.prevPeriod.from, to: o.curPeriod.to },
    calculation: `(${formatMajor(o.cur, o.currency)} − ${formatMajor(o.prev, o.currency)}) ÷ ${formatMajor(o.prev, o.currency)} = ${pct}% (posted expenses net of refunds; transfers excluded).`,
    why: up ? 'A rising category can eat into savings or other budgets if it continues.' : 'Lower spending here frees money for savings or other goals.',
  };
}

export function budgetExceeded(o: { name: string; budgetId: string; currency: string; spent: bigint; budget: bigint; period: P }): Insight | null {
  if (o.spent <= o.budget) return null;
  const over = o.spent - o.budget;
  return {
    ruleId: `budget_exceeded:${o.budgetId}`,
    severity: 'critical',
    headline: `You exceeded your ${o.name} budget`,
    what: `Spending is ${m(o.spent, o.currency)} against a budget of ${m(o.budget, o.currency)}.`,
    period: o.period,
    calculation: `${formatMajor(o.spent, o.currency)} − ${formatMajor(o.budget, o.currency)} = ${formatMajor(over, o.currency)} over budget (posted expenses only).`,
    why: 'Going over budget reduces what you can save this period.',
  };
}

export function savingsRateChange(o: { currency: string; prevIncome: bigint; prevExpense: bigint; curIncome: bigint; curExpense: bigint; prevPeriod: P; curPeriod: P }): Insight | null {
  if (o.prevIncome <= 0n || o.curIncome <= 0n) return null;
  const rate = (inc: bigint, exp: bigint) => Number(((inc - exp) * 100n) / inc);
  const prev = rate(o.prevIncome, o.prevExpense);
  const cur = rate(o.curIncome, o.curExpense);
  if (cur - prev < THRESHOLDS.savingsRatePoints) return null;
  return {
    ruleId: 'savings_rate_improved',
    severity: 'positive',
    headline: 'Your savings rate improved',
    what: `Your savings rate rose from ${prev}% to ${cur}%.`,
    period: { from: o.prevPeriod.from, to: o.curPeriod.to },
    calculation: `Savings rate = (income − expenses) ÷ income. Previous: (${formatMajor(o.prevIncome, o.currency)} − ${formatMajor(o.prevExpense, o.currency)}) ÷ ${formatMajor(o.prevIncome, o.currency)} = ${prev}%. Latest: ${cur}%.`,
    why: 'A higher savings rate means more of your income is building your future.',
  };
}

export function billDueSoon(o: { name: string; billId: string; due: Date; now: Date; expected: bigint; currency: string }): Insight | null {
  const days = Math.ceil((o.due.getTime() - o.now.getTime()) / 86_400_000);
  if (days < 0 || days > THRESHOLDS.billSoonDays) return null;
  return {
    ruleId: `bill_due:${o.billId}:${o.due.toISOString().slice(0, 10)}`,
    severity: days <= 1 ? 'warning' : 'info',
    headline: `${o.name} is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`,
    what: `${o.name} is expected to cost ${m(o.expected, o.currency)}.`,
    period: { from: o.now, to: o.due },
    calculation: `Due date ${o.due.toISOString().slice(0, 10)} − today = ${days} day(s).`,
    why: 'Paying on time avoids late fees and service interruptions.',
  };
}

export function subscriptionSpendChange(o: { currency: string; prev: bigint; cur: bigint; prevPeriod: P; curPeriod: P }): Insight | null {
  const pct = pctChange(o.prev, o.cur);
  if (pct === null || pct < THRESHOLDS.subscriptionChangePct) return null;
  return {
    ruleId: 'subscription_spend_increase',
    severity: 'warning',
    headline: 'Your monthly subscription spending increased',
    what: `Subscription payments were ${m(o.cur, o.currency)}, up from ${m(o.prev, o.currency)}.`,
    period: { from: o.prevPeriod.from, to: o.curPeriod.to },
    calculation: `(${formatMajor(o.cur, o.currency)} − ${formatMajor(o.prev, o.currency)}) ÷ ${formatMajor(o.prev, o.currency)} = ${pct}% (posted payments linked to subscriptions).`,
    why: 'Small recurring charges add up; review whether you still use each one.',
  };
}

export function goalNearlyDone(o: { name: string; goalId: string; current: bigint; target: bigint; currency: string; now: Date }): Insight | null {
  if (o.target <= 0n || o.current >= o.target) return null;
  const pct = Number((o.current * 100n) / o.target);
  if (pct < THRESHOLDS.goalClosePct) return null;
  return {
    ruleId: `goal_close:${o.goalId}`,
    severity: 'positive',
    headline: `You are close to completing "${o.name}"`,
    what: `You have saved ${m(o.current, o.currency)} of ${m(o.target, o.currency)} (${pct}%).`,
    period: { from: o.now, to: o.now },
    calculation: `${formatMajor(o.current, o.currency)} ÷ ${formatMajor(o.target, o.currency)} = ${pct}%. Remaining ${formatMajor(o.target - o.current, o.currency)}.`,
    why: 'Finishing a goal is a good moment to set the next one.',
  };
}
