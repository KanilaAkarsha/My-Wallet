import { describe, expect, it } from 'vitest';
import { monthlyEquivalentMinor, nextOccurrenceAfter, occurrence, occurrencesUntil, validateSchedule, yearlyEquivalentMinor } from './recurrence.js';
import { zonedParts } from '../shared/http.js';
import { resolveRange } from '../shared/dateRange.js';

const local = (d: Date) => { const p = zonedParts(d, 'Asia/Colombo'); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const at = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

describe('recurrence (Asia/Colombo local dates)', () => {
  it('monthly on the 31st clamps to month end and does not drift', () => {
    const s = { frequency: 'monthly' as const, startDate: at('2026-01-31') };
    expect([0, 1, 2, 3, 4].map((n) => local(occurrence(s, n)))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  it('quarterly, yearly (leap day), weekly, daily, custom', () => {
    expect(local(occurrence({ frequency: 'quarterly', startDate: at('2026-11-15') }, 1))).toBe('2027-02-15');
    expect(local(occurrence({ frequency: 'yearly', startDate: at('2028-02-29') }, 1))).toBe('2029-02-28');
    expect(local(occurrence({ frequency: 'weekly', startDate: at('2026-11-10') }, 3))).toBe('2026-12-01');
    expect(local(occurrence({ frequency: 'daily', startDate: at('2026-12-30') }, 3))).toBe('2027-01-02');
    expect(local(occurrence({ frequency: 'custom', intervalDays: 10, startDate: at('2026-11-10') }, 2))).toBe('2026-11-30');
  });
  it('occurrencesUntil respects endDate, `after` and the cap; generation is deterministic (idempotent keys)', () => {
    const s = { frequency: 'monthly' as const, startDate: at('2026-01-05'), endDate: at('2026-04-05') };
    const all = occurrencesUntil(s, at('2026-12-31'));
    expect(all.map(local)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']);
    expect(occurrencesUntil(s, at('2026-12-31'), { after: at('2026-02-05') }).map(local)).toEqual(['2026-03-05', '2026-04-05']);
    expect(occurrencesUntil({ frequency: 'daily', startDate: at('2020-01-01') }, at('2026-01-01'), { cap: 10 })).toHaveLength(10);
    expect(occurrencesUntil(s, at('2026-12-31')).map((d) => d.toISOString())).toEqual(all.map((d) => d.toISOString()));
  });
  it('next occurrence after a date; null after the end', () => {
    const s = { frequency: 'monthly' as const, startDate: at('2026-01-05'), endDate: at('2026-03-05') };
    expect(local(nextOccurrenceAfter(s, at('2026-01-20'))!)).toBe('2026-02-05');
    expect(nextOccurrenceAfter(s, at('2026-03-05'))).toBeNull();
  });
  it('validates custom interval and end date', () => {
    expect(validateSchedule({ frequency: 'custom', startDate: at('2026-01-01') })).toMatch(/intervalDays/);
    expect(validateSchedule({ frequency: 'daily', startDate: at('2026-02-01'), endDate: at('2026-01-01') })).toMatch(/endDate/);
    expect(validateSchedule({ frequency: 'daily', startDate: at('2026-01-01') })).toBeNull();
  });
  it('subscription equivalents are exact integers', () => {
    expect(monthlyEquivalentMinor(120000n, 'yearly')).toBe(10000n);
    expect(monthlyEquivalentMinor(30000n, 'quarterly')).toBe(10000n);
    expect(monthlyEquivalentMinor(10000n, 'monthly')).toBe(10000n);
    expect(monthlyEquivalentMinor(10000n, 'weekly')).toBe(43333n); // 520000/12 = 43333.33
    expect(yearlyEquivalentMinor(10000n, 'monthly')).toBe(120000n);
  });
});

describe('date ranges in Asia/Colombo', () => {
  const now = new Date('2026-11-11T20:00:00Z'); // 2026-11-12 01:30 local (already "tomorrow" vs UTC)
  const L = (d: Date) => local(d);
  it('uses the user’s calendar day, not UTC', () => {
    const r = resolveRange('today', 'Asia/Colombo', now);
    expect([L(r.from), L(r.to)]).toEqual(['2026-11-12', '2026-11-13']);
  });
  it('this month / previous month / last 3 months / this week (Mon start) / last 7 days', () => {
    expect([L(resolveRange('this_month', 'Asia/Colombo', now).from), L(resolveRange('this_month', 'Asia/Colombo', now).to)]).toEqual(['2026-11-01', '2026-12-01']);
    expect([L(resolveRange('previous_month', 'Asia/Colombo', now).from), L(resolveRange('previous_month', 'Asia/Colombo', now).to)]).toEqual(['2026-10-01', '2026-11-01']);
    expect(L(resolveRange('last_3_months', 'Asia/Colombo', now).from)).toBe('2026-09-01');
    expect(L(resolveRange('this_week', 'Asia/Colombo', now).from)).toBe('2026-11-09'); // Monday
    expect(L(resolveRange('last_7_days', 'Asia/Colombo', now).from)).toBe('2026-11-06');
  });
  it('custom needs from < to', () => {
    expect(() => resolveRange('custom', 'Asia/Colombo', now)).toThrow();
    expect(resolveRange('custom', 'Asia/Colombo', now, at('2026-01-01'), at('2026-02-01')).to).toEqual(at('2026-02-01'));
  });
});
