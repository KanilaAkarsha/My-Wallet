/** Pure planning maths for student / young-professional modes. Integer minor units only. */
export interface PaceResult { spentMinor: bigint; limitMinor: bigint; remainingMinor: bigint; percentUsed: number; status: 'on_track' | 'warning' | 'exceeded' }

export function limitUsage(spentMinor: bigint, limitMinor: bigint, warnAt = 80): PaceResult {
  const remaining = limitMinor - spentMinor;
  const pct = limitMinor > 0n ? Number((spentMinor * 100n) / limitMinor) : spentMinor > 0n ? 100 : 0;
  return { spentMinor, limitMinor, remainingMinor: remaining, percentUsed: pct, status: spentMinor > limitMinor ? 'exceeded' : pct >= warnAt ? 'warning' : 'on_track' };
}

/** Safe daily spend for the rest of a period (days inclusive of today). Zero if nothing remains. */
export function dailyAllowance(remainingMinor: bigint, daysLeft: number): bigint {
  if (daysLeft <= 0 || remainingMinor <= 0n) return 0n;
  return remainingMinor / BigInt(daysLeft);
}

export function daysBetween(from: Date, to: Date): number { return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)); }

/** How many months of average expenses the emergency fund covers. null when expenses are unknown/zero. */
export function emergencyCoverage(fundMinor: bigint, avgMonthlyExpenseMinor: bigint, targetMonths: number) {
  const targetMinor = avgMonthlyExpenseMinor * BigInt(targetMonths);
  const months = avgMonthlyExpenseMinor > 0n ? Number((fundMinor * 100n) / avgMonthlyExpenseMinor) / 100 : null;
  return { months, targetMinor, shortfallMinor: targetMinor > fundMinor ? targetMinor - fundMinor : 0n };
}

/** 50/30/20 guideline split of take-home pay (needs/wants/savings). A guideline, not advice. */
export function splitGuideline(incomeMinor: bigint) {
  const needs = (incomeMinor * 50n) / 100n;
  const wants = (incomeMinor * 30n) / 100n;
  return { needsMinor: needs, wantsMinor: wants, savingsMinor: incomeMinor - needs - wants };
}

export function savingsRatePercent(incomeMinor: bigint, expenseMinor: bigint): number | null {
  return incomeMinor > 0n ? Number(((incomeMinor - expenseMinor) * 100n) / incomeMinor) : null;
}
