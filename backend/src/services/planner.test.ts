import { describe, expect, it } from 'vitest';
import { dailyAllowance, daysBetween, emergencyCoverage, limitUsage, savingsRatePercent, splitGuideline } from './planner.js';

describe('planner maths', () => {
  it('limitUsage statuses', () => {
    expect(limitUsage(5000n, 10000n).status).toBe('on_track');
    expect(limitUsage(8000n, 10000n).status).toBe('warning');
    expect(limitUsage(10001n, 10000n).status).toBe('exceeded');
    expect(limitUsage(0n, 0n).percentUsed).toBe(0);
    expect(limitUsage(5n, 0n).status).toBe('exceeded');
  });
  it('dailyAllowance never negative and floors', () => {
    expect(dailyAllowance(10000n, 3)).toBe(3333n);
    expect(dailyAllowance(-5n, 3)).toBe(0n);
    expect(dailyAllowance(100n, 0)).toBe(0n);
  });
  it('emergencyCoverage', () => {
    const c = emergencyCoverage(300000n, 100000n, 6);
    expect(c.months).toBe(3);
    expect(c.targetMinor).toBe(600000n);
    expect(c.shortfallMinor).toBe(300000n);
    expect(emergencyCoverage(1n, 0n, 6).months).toBeNull();
  });
  it('splitGuideline sums to income', () => {
    const s = splitGuideline(100001n);
    expect(s.needsMinor + s.wantsMinor + s.savingsMinor).toBe(100001n);
  });
  it('savingsRate and daysBetween', () => {
    expect(savingsRatePercent(100000n, 80000n)).toBe(20);
    expect(savingsRatePercent(0n, 5n)).toBeNull();
    expect(daysBetween(new Date('2026-01-01'), new Date('2026-01-11'))).toBe(10);
  });
});
