import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  applyBps,
  convertMinor,
  divRound,
  formatMajor,
  parseMajor,
} from './money.js';
import {
  buildRefund,
  buildReversal,
  buildTransfer,
  computeBalance,
  computeBudgetUsage,
  computePeriodTotals,
  reconcile,
  type LedgerEntry,
  type TransferAccount,
} from './ledger.js';
import { accrueSimpleInterest, allocateDebtPayment, periodicInterest } from './debt.js';

let n = 0;
const newId = () => `id${++n}`;
const D = (s: string) => new Date(`${s}T00:00:00Z`);

const entry = (o: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amountMinor'>): LedgerEntry => ({
  id: newId(),
  accountId: 'A',
  status: 'posted',
  currency: 'LKR',
  date: D('2026-11-05'),
  ...o,
});

describe('money', () => {
  it('parses and formats LKR with 2dp exactly', () => {
    expect(parseMajor('1234.5', 'LKR')).toBe(123450n);
    expect(parseMajor('0.07', 'LKR')).toBe(7n);
    expect(parseMajor('-10', 'LKR')).toBe(-1000n);
    expect(formatMajor(123450n, 'LKR')).toBe('1234.50');
    expect(formatMajor(-5n, 'LKR')).toBe('-0.05');
    expect(formatMajor(500n, 'JPY')).toBe('500');
  });
  it('rejects excess precision, junk, unsupported currencies', () => {
    expect(() => parseMajor('1.234', 'LKR')).toThrow(MoneyError);
    expect(() => parseMajor('abc', 'LKR')).toThrow(MoneyError);
    expect(() => parseMajor('1e3', 'LKR')).toThrow(MoneyError);
    expect(() => parseMajor('1', 'XXX')).toThrow(MoneyError);
  });
  it('is exact where floats are not (0.1 + 0.2)', () => {
    expect(parseMajor('0.10', 'LKR') + parseMajor('0.20', 'LKR')).toBe(parseMajor('0.30', 'LKR'));
  });
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(applyBps(10001n, 5000n)).toBe(5001n);
  });
  it('converts across currencies and exponents with an explicit rate', () => {
    // 100.00 USD @ 300.50 LKR/USD = 30,050.00 LKR
    expect(convertMinor(10000n, 'USD', 'LKR', '300.50')).toBe(3005000n);
    // 1000 JPY @ 2.1 LKR/JPY = 2100.00 LKR
    expect(convertMinor(1000n, 'JPY', 'LKR', '2.1')).toBe(210000n);
    expect(() => convertMinor(1n, 'USD', 'LKR', '0')).toThrow(MoneyError);
  });
});

describe('account balance', () => {
  it('opening + income - expense + transfers + adjustments', () => {
    const entries = [
      entry({ kind: 'income', amountMinor: 100000n }),
      entry({ kind: 'expense', amountMinor: 25000n }),
      entry({ kind: 'transfer', direction: 'in', amountMinor: 5000n }),
      entry({ kind: 'transfer', direction: 'out', amountMinor: 2000n }),
      entry({ kind: 'adjustment', direction: 'in', amountMinor: 100n }),
      entry({ kind: 'adjustment', direction: 'out', amountMinor: 50n }),
    ];
    expect(computeBalance({ openingBalanceMinor: 10000n, currency: 'LKR', entries })).toBe(10000n + 100000n - 25000n + 5000n - 2000n + 100n - 50n);
  });
  it('pending and failed entries never affect balances', () => {
    const entries = [
      entry({ kind: 'income', amountMinor: 999n, status: 'pending' }),
      entry({ kind: 'expense', amountMinor: 999n, status: 'failed' }),
    ];
    expect(computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries })).toBe(0n);
  });
  it('refuses to mix currencies', () => {
    expect(() =>
      computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries: [entry({ kind: 'income', amountMinor: 1n, currency: 'USD' })] }),
    ).toThrow(/currency/);
  });
  it('requires a direction on transfers/adjustments', () => {
    expect(() => computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries: [entry({ kind: 'transfer', amountMinor: 1n })] })).toThrow(/direction/);
  });
});

describe('period totals (transfers are not income/expense)', () => {
  const entries = [
    entry({ kind: 'income', amountMinor: 100000n }),
    entry({ kind: 'expense', amountMinor: 30000n }),
    entry({ kind: 'transfer', direction: 'out', amountMinor: 50000n }),
    entry({ kind: 'transfer', direction: 'in', amountMinor: 50000n }),
    entry({ kind: 'loan_interest', amountMinor: 1500n }),
    entry({ kind: 'income', amountMinor: 7777n, date: D('2026-10-01') }), // outside period
    entry({ kind: 'expense', amountMinor: 1n, status: 'pending' }),
  ];
  const period = { from: D('2026-11-01'), to: D('2026-12-01') };
  it('excludes transfers, pending and out-of-period; includes loan interest as expense', () => {
    const t = computePeriodTotals(entries, 'LKR', period);
    expect(t.incomeMinor).toBe(100000n);
    expect(t.expenseMinor).toBe(31500n);
    expect(t.netMinor).toBe(68500n);
  });
  it('refunds reduce expenses and are not income', () => {
    const exp = entry({ kind: 'expense', amountMinor: 10000n });
    const refund = buildRefund({ original: exp, existingRefunds: [], amountMinor: 4000n, date: D('2026-11-06'), newId });
    const t = computePeriodTotals([exp, refund], 'LKR', period);
    expect(t.expenseMinor).toBe(6000n);
    expect(t.incomeMinor).toBe(0n);
  });
});

describe('refunds', () => {
  it('credits the account and cannot exceed the original', () => {
    const exp = entry({ kind: 'expense', amountMinor: 10000n });
    const r1 = buildRefund({ original: exp, existingRefunds: [], amountMinor: 6000n, date: D('2026-11-06'), newId });
    expect(computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries: [exp, r1] })).toBe(-4000n);
    expect(() => buildRefund({ original: exp, existingRefunds: [r1], amountMinor: 4001n, date: D('2026-11-07'), newId })).toThrow(/exceeds/);
    const r2 = buildRefund({ original: exp, existingRefunds: [r1], amountMinor: 4000n, date: D('2026-11-07'), newId });
    expect(computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries: [exp, r1, r2] })).toBe(0n);
  });
  it('only posted expenses can be refunded', () => {
    expect(() => buildRefund({ original: entry({ kind: 'income', amountMinor: 1n }), existingRefunds: [], amountMinor: 1n, date: D('2026-11-06'), newId })).toThrow();
    expect(() => buildRefund({ original: entry({ kind: 'expense', amountMinor: 1n, status: 'pending' }), existingRefunds: [], amountMinor: 1n, date: D('2026-11-06'), newId })).toThrow();
  });
});

describe('reversals (immutable history)', () => {
  it('offset the original exactly, in balances and totals', () => {
    const inc = entry({ kind: 'income', amountMinor: 5000n });
    const rev = buildReversal(inc, newId, D('2026-11-08'));
    const original = { ...inc, status: 'reversed' as const }; // the only permitted mutation
    expect(computeBalance({ openingBalanceMinor: 100n, currency: 'LKR', entries: [original, rev] })).toBe(100n);
    expect(computePeriodTotals([original, rev], 'LKR').incomeMinor).toBe(0n);
  });
  it('cannot reverse non-posted entries or reversals', () => {
    expect(() => buildReversal(entry({ kind: 'income', amountMinor: 1n, status: 'pending' }), newId, D('2026-11-08'))).toThrow();
    const rev = buildReversal(entry({ kind: 'income', amountMinor: 1n }), newId, D('2026-11-08'));
    expect(() => buildReversal(rev, newId, D('2026-11-09'))).toThrow();
  });
  it('reversed expenses do not count towards budgets', () => {
    const exp = entry({ kind: 'expense', amountMinor: 9000n, categoryId: 'food' });
    const rev = buildReversal(exp, newId, D('2026-11-08'));
    const u = computeBudgetUsage({
      entries: [{ ...exp, status: 'reversed' }, rev],
      currency: 'LKR',
      period: { from: D('2026-11-01'), to: D('2026-12-01') },
      categoryIds: ['food'],
      budgetMinor: 10000n,
    });
    expect(u.spentMinor).toBe(0n);
  });
});

describe('budgets', () => {
  const period = { from: D('2026-11-01'), to: D('2026-12-01') };
  const mk = (amt: bigint, cat = 'food') => entry({ kind: 'expense', amountMinor: amt, categoryId: cat });
  it('healthy / warning / exceeded thresholds', () => {
    const run = (spent: bigint) => computeBudgetUsage({ entries: [mk(spent)], currency: 'LKR', period, categoryIds: ['food'], budgetMinor: 10000n });
    expect(run(7999n).status).toBe('healthy');
    expect(run(8000n).status).toBe('warning');
    expect(run(10000n).status).toBe('warning');
    expect(run(10001n).status).toBe('exceeded');
    expect(run(2500n)).toMatchObject({ percentUsed: 25, remainingMinor: 7500n });
  });
  it('ignores other categories, transfers and pending', () => {
    const u = computeBudgetUsage({
      entries: [
        mk(1000n),
        mk(5000n, 'transport'),
        entry({ kind: 'transfer', direction: 'out', amountMinor: 99999n, categoryId: 'food' }),
        entry({ kind: 'expense', amountMinor: 4000n, categoryId: 'food', status: 'pending' }),
      ],
      currency: 'LKR',
      period,
      categoryIds: ['food'],
      budgetMinor: 10000n,
    });
    expect(u.spentMinor).toBe(1000n);
  });
});

describe('transfers', () => {
  const acc = (id: string, currency = 'LKR', userId = 'u1', status: 'active' | 'archived' = 'active'): TransferAccount => ({ id, userId, currency, status });
  const base = { userId: 'u1', date: D('2026-11-09'), transferGroupId: 'g1', newId };

  it('records both sides with equal amounts; net worth unchanged', () => {
    const t = buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: 20000n });
    expect(t.out).toMatchObject({ accountId: 'A', direction: 'out', amountMinor: 20000n, kind: 'transfer' });
    expect(t.in).toMatchObject({ accountId: 'B', direction: 'in', amountMinor: 20000n });
    expect(t.out.transferGroupId).toBe(t.in.transferGroupId);
    const a = computeBalance({ openingBalanceMinor: 50000n, currency: 'LKR', entries: [t.out] });
    const b = computeBalance({ openingBalanceMinor: 0n, currency: 'LKR', entries: [{ ...t.in, accountId: 'B' }] });
    expect(a + b).toBe(50000n);
    expect(computePeriodTotals([t.out, t.in], 'LKR')).toEqual({ incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n });
  });
  it('rejects other users’ accounts, same account, archived accounts, bad amounts', () => {
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B', 'LKR', 'u2'), amountMinor: 1n })).toThrow(/belong/);
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('A'), amountMinor: 1n })).toThrow(/differ/);
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B', 'LKR', 'u1', 'archived'), amountMinor: 1n })).toThrow(/Archived/);
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: 0n })).toThrow();
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: -5n })).toThrow();
  });
  it('enforces available funds unless overdraft is allowed', () => {
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: 100n, sourceBalanceMinor: 99n })).toThrow(/Insufficient/);
    expect(buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: 100n, sourceBalanceMinor: 99n, allowOverdraft: true }).out.amountMinor).toBe(100n);
  });
  it('cross-currency needs an explicit rate and records conversion details', () => {
    expect(() => buildTransfer({ ...base, from: acc('A', 'USD'), to: acc('B', 'LKR'), amountMinor: 10000n })).toThrow(/explicit/);
    const t = buildTransfer({ ...base, from: acc('A', 'USD'), to: acc('B', 'LKR'), amountMinor: 10000n, rate: '300' });
    expect(t.in.amountMinor).toBe(3000000n);
    expect(t.conversion).toEqual({ rate: '300', fromCurrency: 'USD', toCurrency: 'LKR' });
    expect(() => buildTransfer({ ...base, from: acc('A'), to: acc('B'), amountMinor: 1n, rate: '2' })).toThrow();
  });
});

describe('reconciliation', () => {
  it('flags discrepancies', () => {
    const entries = [entry({ kind: 'income', amountMinor: 1000n })];
    expect(reconcile({ openingBalanceMinor: 0n, currency: 'LKR', entries, statementBalanceMinor: 1000n }).reconciled).toBe(true);
    const r = reconcile({ openingBalanceMinor: 0n, currency: 'LKR', entries, statementBalanceMinor: 900n });
    expect(r).toMatchObject({ reconciled: false, differenceMinor: -100n });
  });
});

describe('debt', () => {
  it('simple interest on a 365-day basis, rounded', () => {
    // 100,000.00 LKR @ 12% for 30 days = 986.30 (98630.137 minor -> 98630)
    expect(accrueSimpleInterest(10_000_000n, 1200n, 30)).toBe(98630n);
    expect(accrueSimpleInterest(10_000_000n, 1200n, 0)).toBe(0n);
  });
  it('periodic interest on reducing balance', () => {
    // 120,000.00 @ 12% monthly = 1,200.00
    expect(periodicInterest(12_000_000n, 1200n, 12)).toBe(120000n);
  });
  it('pays interest first, then principal; interest is the only expense part', () => {
    const a = allocateDebtPayment({ outstandingPrincipalMinor: 100000n, accruedInterestMinor: 3000n, paymentMinor: 10000n });
    expect(a).toEqual({ interestMinor: 3000n, principalMinor: 7000n, newOutstandingPrincipalMinor: 93000n, newAccruedInterestMinor: 0n });
    const small = allocateDebtPayment({ outstandingPrincipalMinor: 100000n, accruedInterestMinor: 3000n, paymentMinor: 2000n });
    expect(small).toMatchObject({ interestMinor: 2000n, principalMinor: 0n, newAccruedInterestMinor: 1000n });
  });
  it('rejects overpayment', () => {
    expect(() => allocateDebtPayment({ outstandingPrincipalMinor: 100n, accruedInterestMinor: 10n, paymentMinor: 111n })).toThrow(/exceeds/);
  });
  it('payment split books only interest as expense; principal repayment leaves totals untouched', () => {
    const a = allocateDebtPayment({ outstandingPrincipalMinor: 100000n, accruedInterestMinor: 3000n, paymentMinor: 10000n });
    // account side: the full payment leaves the account; income/expense side: interest only
    const interestEntry = entry({ kind: 'loan_interest', amountMinor: a.interestMinor });
    const totals = computePeriodTotals([interestEntry], 'LKR');
    expect(totals.expenseMinor).toBe(3000n);
  });
});
