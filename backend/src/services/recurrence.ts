/**
 * Recurrence maths on LOCAL calendar dates (default Asia/Colombo). Occurrence dates are local
 * midnights, so "monthly on the 31st" clamps to the month's last day and never drifts.
 */
import { zonedMidnight, zonedParts } from '../shared/http.js';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface Schedule {
  frequency: Frequency;
  intervalDays?: number | null;
  startDate: Date;
  endDate?: Date | null;
  timezone?: string;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** The n-th occurrence (n >= 0) of the schedule, anchored to startDate's local day-of-month. */
export function occurrence(s: Schedule, n: number): Date {
  const tz = s.timezone ?? 'Asia/Colombo';
  const a = zonedParts(s.startDate, tz);
  switch (s.frequency) {
    case 'daily':
      return zonedMidnight(a.y, a.m, a.d + n, tz);
    case 'weekly':
      return zonedMidnight(a.y, a.m, a.d + 7 * n, tz);
    case 'custom':
      return zonedMidnight(a.y, a.m, a.d + (s.intervalDays ?? 1) * n, tz);
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      const step = s.frequency === 'monthly' ? 1 : s.frequency === 'quarterly' ? 3 : 12;
      const total = a.m - 1 + step * n;
      const y = a.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      return zonedMidnight(y, m, Math.min(a.d, daysInMonth(y, m)), tz);
    }
  }
}

/** All occurrences with date <= `until` (and <= endDate), starting at index `fromIndex`. Capped to stop runaway loops. */
export function occurrencesUntil(s: Schedule, until: Date, opts: { after?: Date; cap?: number } = {}): Date[] {
  const cap = opts.cap ?? 400;
  const out: Date[] = [];
  for (let n = 0; n < 100_000 && out.length < cap; n++) {
    const d = occurrence(s, n);
    if (s.endDate && d > s.endDate) break;
    if (d > until) break;
    if (!opts.after || d > opts.after) out.push(d);
  }
  return out;
}

/** First occurrence strictly after `after` (for "next due date"). */
export function nextOccurrenceAfter(s: Schedule, after: Date): Date | null {
  for (let n = 0; n < 100_000; n++) {
    const d = occurrence(s, n);
    if (s.endDate && d > s.endDate) return null;
    if (d > after) return d;
  }
  return null;
}

export function validateSchedule(s: Schedule): string | null {
  if (s.frequency === 'custom' && (!s.intervalDays || s.intervalDays < 1)) return 'Custom schedules need intervalDays >= 1';
  if (s.endDate && s.endDate < s.startDate) return 'endDate must not be before startDate';
  return null;
}

/** Monthly-equivalent / yearly-equivalent cost in minor units (rounded half away from zero). */
export function monthlyEquivalentMinor(amountMinor: bigint, f: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): bigint {
  const num = { weekly: 52n, monthly: 12n, quarterly: 4n, yearly: 1n }[f];
  const q = amountMinor * num;
  return (q * 2n + 12n) / 24n; // q/12 rounded half up (amounts are non-negative)
}
export const yearlyEquivalentMinor = (amountMinor: bigint, f: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): bigint =>
  amountMinor * { weekly: 52n, monthly: 12n, quarterly: 4n, yearly: 1n }[f];
