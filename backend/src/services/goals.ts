/** Savings-goal maths (pure). */
export interface Flow { date: Date; signedMinor: bigint } // +contribution, -withdrawal

export function progressPercent(current: bigint, target: bigint): number {
  if (target <= 0n) return 0;
  const p = Number((current * 100n) / target);
  return Math.max(0, Math.min(100, p));
}

/** Estimates completion from the average net flow of the last `windowDays`. Null when there is no positive trend. */
export function estimateCompletion(target: bigint, current: bigint, flows: readonly Flow[], now: Date, windowDays = 90) {
  const remaining = target - current;
  if (remaining <= 0n) return { reached: true as const };
  const since = now.getTime() - windowDays * 86_400_000;
  const net = flows.filter((f) => f.date.getTime() >= since && f.date.getTime() <= now.getTime()).reduce((s, f) => s + f.signedMinor, 0n);
  if (net <= 0n) return null;
  // days = ceil(remaining * windowDays / net)
  const days = Number((remaining * BigInt(windowDays) + net - 1n) / net);
  return { reached: false as const, dailyRateMinor: net / BigInt(windowDays), daysRemaining: days, estimatedDate: new Date(now.getTime() + days * 86_400_000) };
}

export const MILESTONES = [25, 50, 75, 100] as const;
export const milestoneReached = (before: number, after: number): number | null => [...MILESTONES].reverse().find((m) => before < m && after >= m) ?? null;
