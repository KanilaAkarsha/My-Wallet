import { describe, expect, it } from 'vitest';
import { balanceFromGroups, groupEntries, parseGroupRows, toBig, totalsFromGroups } from './aggregate.js';
import { computeBalance, computePeriodTotals, type EntryKind, type LedgerEntry } from './ledger.js';

// Deterministic PRNG so failures are reproducible.
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function randomEntries(n: number, seed: number): LedgerEntry[] {
  const r = rng(seed);
  const kinds: EntryKind[] = ['income', 'expense', 'transfer', 'refund', 'adjustment', 'loan_interest'];
  const statuses = ['posted', 'posted', 'posted', 'pending', 'failed', 'reversed'] as const;
  return Array.from({ length: n }, (_, i) => {
    const kind = kinds[Math.floor(r() * kinds.length)]!;
    return {
      id: String(i),
      accountId: 'A',
      kind,
      status: statuses[Math.floor(r() * statuses.length)]!,
      amountMinor: BigInt(1 + Math.floor(r() * 1_000_000)),
      currency: 'LKR',
      direction: kind === 'transfer' || kind === 'adjustment' ? (r() < 0.5 ? 'in' : 'out') : undefined,
      date: new Date(2026, 10, 1),
      reversalOf: r() < 0.1 ? 'x' : undefined,
    } as LedgerEntry;
  });
}

describe('group folding equals the entry-level engine', () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    it(`random ledger (seed ${seed})`, () => {
      const entries = randomEntries(500, seed);
      const groups = groupEntries(entries);
      expect(balanceFromGroups(12345n, groups)).toBe(computeBalance({ openingBalanceMinor: 12345n, currency: 'LKR', entries }));
      expect(totalsFromGroups(groups)).toEqual(computePeriodTotals(entries, 'LKR'));
    });
  }
  it('parses Mongo rows (number or Long-like) without precision loss', () => {
    expect(toBig(5)).toBe(5n);
    expect(toBig({ toString: () => '9007199254740993' })).toBe(9007199254740993n);
    const g = parseGroupRows([{ _id: { kind: 'income', direction: null, reversal: false }, sum: 100 }]);
    expect(g).toEqual([{ kind: 'income', direction: null, reversal: false, sumMinor: 100n }]);
  });
});
