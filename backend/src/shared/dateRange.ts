import { z } from 'zod';
import { badRequest } from './errors.js';
import { zonedMidnight, zonedParts } from './http.js';

export const rangeKeys = ['today', 'this_week', 'last_7_days', 'this_month', 'previous_month', 'last_3_months', 'custom'] as const;
export type RangeKey = (typeof rangeKeys)[number];

export const rangeQuery = z.object({
  range: z.enum(rangeKeys).default('this_month'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Half-open [from, to) in the user's timezone. Weeks start Monday. */
export function resolveRange(key: RangeKey, tz: string, now = new Date(), from?: Date, to?: Date): { from: Date; to: Date } {
  const { y, m, d } = zonedParts(now, tz);
  const day = (yy: number, mm: number, dd: number) => zonedMidnight(yy, mm, dd, tz);
  const tomorrow = day(y, m, d + 1);
  switch (key) {
    case 'today':
      return { from: day(y, m, d), to: tomorrow };
    case 'this_week': {
      const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0
      return { from: day(y, m, d - dow), to: tomorrow };
    }
    case 'last_7_days':
      return { from: day(y, m, d - 6), to: tomorrow };
    case 'this_month':
      return { from: day(y, m, 1), to: day(y, m + 1, 1) };
    case 'previous_month':
      return { from: day(y, m - 1, 1), to: day(y, m, 1) };
    case 'last_3_months':
      return { from: day(y, m - 2, 1), to: day(y, m + 1, 1) };
    case 'custom':
      if (!from || !to || to <= from) throw badRequest('Custom range needs from < to');
      if (to.getTime() - from.getTime() > 5 * 366 * 86_400_000) throw badRequest('Range too large');
      return { from, to };
  }
}
