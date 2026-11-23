import { describe, expect, it } from 'vitest';
import { estimateCompletion, milestoneReached, progressPercent } from './goals.js';

const now = new Date('2026-11-10T00:00:00Z');
const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
describe('goals', () => {
  it('progress is integer percent clamped to 0..100', () => {
    expect(progressPercent(2500n, 10000n)).toBe(25);
    expect(progressPercent(20000n, 10000n)).toBe(100);
    expect(progressPercent(-5n, 10000n)).toBe(0);
    expect(progressPercent(1n, 0n)).toBe(0);
  });
  it('estimates from net flow over the window', () => {
    const e = estimateCompletion(100000n, 10000n, [{ date: d(10), signedMinor: 9000n }, { date: d(5), signedMinor: 9000n }], now, 90);
    // net 18000 over 90 days; remaining 90000 -> 450 days
    expect(e).toMatchObject({ reached: false, daysRemaining: 450 });
  });
  it('ignores old flows, returns null for no/negative trend, reached when done', () => {
    expect(estimateCompletion(100n, 0n, [{ date: d(200), signedMinor: 50n }], now)).toBeNull();
    expect(estimateCompletion(100n, 0n, [{ date: d(1), signedMinor: -50n }], now)).toBeNull();
    expect(estimateCompletion(100n, 100n, [], now)).toEqual({ reached: true });
  });
  it('detects the highest milestone crossed', () => {
    expect(milestoneReached(20, 55)).toBe(50);
    expect(milestoneReached(50, 60)).toBeNull();
    expect(milestoneReached(90, 100)).toBe(100);
  });
});
