/**
 * Group-level folding: lets MongoDB do the heavy lifting ($group + $sum) while the
 * accounting semantics stay HERE, identical to ledger.ts (proved by a property test).
 */
import type { Direction, EntryKind, LedgerEntry, PeriodTotals } from './ledger.js';
import { MoneyError } from './money.js';

export interface Group {
  kind: EntryKind;
  direction?: Direction | null;
  reversal: boolean;
  sumMinor: bigint;
}

export function groupEffect(g: Group): bigint {
  let sign: 1n | -1n;
  switch (g.kind) {
    case 'income':
    case 'refund':
      sign = 1n;
      break;
    case 'expense':
    case 'loan_interest':
      sign = -1n;
      break;
    case 'transfer':
    case 'adjustment':
      if (g.direction !== 'in' && g.direction !== 'out') throw new MoneyError(`${g.kind} group requires a direction`);
      sign = g.direction === 'in' ? 1n : -1n;
      break;
    default:
      throw new MoneyError(`Unknown kind ${String(g.kind)}`);
  }
  const e = sign * g.sumMinor;
  return g.reversal ? -e : e;
}

export const balanceFromGroups = (opening: bigint, groups: readonly Group[]): bigint => groups.reduce((s, g) => s + groupEffect(g), opening);

export function totalsFromGroups(groups: readonly Group[]): PeriodTotals {
  let income = 0n;
  let expense = 0n;
  for (const g of groups) {
    const s = g.reversal ? -g.sumMinor : g.sumMinor;
    if (g.kind === 'income') income += s;
    else if (g.kind === 'expense' || g.kind === 'loan_interest') expense += s;
    else if (g.kind === 'refund') expense -= s;
  }
  return { incomeMinor: income, expenseMinor: expense, netMinor: income - expense };
}

/** In-memory equivalent of the Mongo $group stage (used by tests and small data sets). Only counted statuses. */
export function groupEntries(entries: readonly LedgerEntry[]): Group[] {
  const m = new Map<string, Group>();
  for (const e of entries) {
    if (e.status !== 'posted' && e.status !== 'reversed') continue;
    const reversal = !!e.reversalOf;
    const direction = e.kind === 'transfer' || e.kind === 'adjustment' ? e.direction ?? null : null;
    const k = `${e.kind}|${direction}|${reversal}`;
    const g = m.get(k);
    if (g) g.sumMinor += e.amountMinor;
    else m.set(k, { kind: e.kind, direction, reversal, sumMinor: e.amountMinor });
  }
  return [...m.values()];
}

/** MongoDB pipeline fragment producing rows parseable by `parseGroupRows`. */
export const GROUP_STAGE = (extraId: Record<string, unknown> = {}) => ({
  $group: {
    _id: {
      kind: '$type',
      direction: { $ifNull: ['$direction', null] },
      reversal: { $cond: [{ $ifNull: ['$reversalOf', false] }, true, false] },
      ...extraId,
    },
    sum: { $sum: '$amountMinor' },
  },
});

export interface RawRow {
  _id: { kind: EntryKind; direction: Direction | null; reversal: boolean } & Record<string, unknown>;
  sum: unknown;
}
/** Long/number/bigint -> bigint without float rounding. */
export const toBig = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt(String(v ?? 0)));
export const parseGroupRows = (rows: readonly RawRow[]): Group[] =>
  rows.map((r) => ({ kind: r._id.kind, direction: r._id.direction, reversal: r._id.reversal, sumMinor: toBig(r.sum) }));
