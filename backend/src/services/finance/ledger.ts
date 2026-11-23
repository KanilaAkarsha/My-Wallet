/**
 * Pure financial engine: no I/O, no floats. The database layer feeds it entries;
 * it decides what counts towards balances, budgets and reports.
 *
 * Entry model
 *  - `amountMinor` is always POSITIVE. Direction comes from kind (+ `direction` where needed).
 *  - Entries are immutable once posted. Corrections are made with reversal entries
 *    (`reversalOf` set), which carry the negated effect of the original.
 *
 * Status semantics
 *  - pending / failed : never affect balances, budgets or reports.
 *  - posted           : counts.
 *  - reversed         : original entry that has been offset by a reversal entry. It STILL counts,
 *                       because the posted reversal entry cancels it. (Net effect: zero.)
 */
import { MoneyError, assertPositiveMinor, convertMinor, exponentOf } from './money.js';

export type EntryKind = 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment' | 'loan_interest';
export type EntryStatus = 'pending' | 'posted' | 'reversed' | 'failed';
export type Direction = 'in' | 'out';

export interface LedgerEntry {
  id: string;
  accountId: string;
  kind: EntryKind;
  status: EntryStatus;
  amountMinor: bigint;
  currency: string;
  /** Required for transfer and adjustment. Ignored otherwise. */
  direction?: Direction;
  categoryId?: string;
  /** Instant of the transaction. */
  date: Date;
  /** Set on entries that exactly offset an earlier entry. */
  reversalOf?: string;
  /** For refunds: the expense being refunded. */
  refundOf?: string;
  transferGroupId?: string;
}

const COUNTED: ReadonlySet<EntryStatus> = new Set(['posted', 'reversed']);

export function countsTowardsBalances(e: Pick<LedgerEntry, 'status'>): boolean {
  return COUNTED.has(e.status);
}

/** Signed effect of an entry on its account's balance (positive = money in). */
export function balanceEffect(e: LedgerEntry): bigint {
  if (!countsTowardsBalances(e)) return 0n;
  let sign: 1n | -1n;
  switch (e.kind) {
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
      if (e.direction !== 'in' && e.direction !== 'out') {
        throw new MoneyError(`${e.kind} entry ${e.id} requires a direction`);
      }
      sign = e.direction === 'in' ? 1n : -1n;
      break;
    default: {
      const never: never = e.kind;
      throw new MoneyError(`Unknown entry kind: ${String(never)}`);
    }
  }
  const effect = sign * e.amountMinor;
  return e.reversalOf ? -effect : effect;
}

export interface BalanceInput {
  openingBalanceMinor: bigint;
  currency: string;
  entries: readonly LedgerEntry[];
}

/** Opening balance + posted effects. Entries for other currencies are rejected, never silently summed. */
export function computeBalance({ openingBalanceMinor, currency, entries }: BalanceInput): bigint {
  let total = openingBalanceMinor;
  for (const e of entries) {
    if (e.currency !== currency) {
      throw new MoneyError(`Entry ${e.id} currency ${e.currency} does not match account currency ${currency}`);
    }
    total += balanceEffect(e);
  }
  return total;
}

export interface PeriodTotals {
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
}

export interface Period {
  from: Date; // inclusive
  to: Date; // exclusive
}

function inPeriod(d: Date, p?: Period): boolean {
  if (!p) return true;
  return d.getTime() >= p.from.getTime() && d.getTime() < p.to.getTime();
}

/**
 * Income / expense totals for ONE currency.
 * - Transfers and adjustments are excluded (not income, not expenses).
 * - Refunds reduce expenses (they do not count as income).
 * - Loan interest counts as an expense.
 * - Reversal entries negate the original's contribution.
 */
export function computePeriodTotals(entries: readonly LedgerEntry[], currency: string, period?: Period): PeriodTotals {
  let income = 0n;
  let expense = 0n;
  for (const e of entries) {
    if (e.currency !== currency || !countsTowardsBalances(e) || !inPeriod(e.date, period)) continue;
    const signed = e.reversalOf ? -e.amountMinor : e.amountMinor;
    switch (e.kind) {
      case 'income':
        income += signed;
        break;
      case 'expense':
      case 'loan_interest':
        expense += signed;
        break;
      case 'refund':
        expense -= signed;
        break;
      default:
        break; // transfer, adjustment
    }
  }
  return { incomeMinor: income, expenseMinor: expense, netMinor: income - expense };
}

/** Budget usage: eligible posted expenses (net of refunds) for the category/period. Transfers never count. */
export function computeBudgetUsage(opts: {
  entries: readonly LedgerEntry[];
  currency: string;
  period: Period;
  categoryIds?: readonly string[]; // undefined = all categories
  budgetMinor: bigint;
  warnAtPercent?: number; // default 80
}) {
  const { entries, currency, period, categoryIds, budgetMinor } = opts;
  const warn = BigInt(opts.warnAtPercent ?? 80);
  const cats = categoryIds ? new Set(categoryIds) : undefined;
  const filtered = entries.filter((e) => !cats || (e.categoryId !== undefined && cats.has(e.categoryId)));
  const spentMinor = computePeriodTotals(filtered, currency, period).expenseMinor;
  const remainingMinor = budgetMinor - spentMinor;
  // Integer percent (floor). budgetMinor of 0 is treated as fully used if anything was spent.
  return { spentMinor, remainingMinor, ...budgetStatus(spentMinor, budgetMinor, Number(warn)) };
}

/** Integer-percent usage and traffic-light status shared by the entry-level and aggregate paths. */
export function budgetStatus(spentMinor: bigint, budgetMinor: bigint, warnAtPercent = 80) {
  const warn = BigInt(warnAtPercent);
  const percentUsed = budgetMinor > 0n ? Number((spentMinor * 100n) / budgetMinor) : spentMinor > 0n ? 100 : 0;
  const status: 'healthy' | 'warning' | 'exceeded' =
    spentMinor > budgetMinor ? 'exceeded' : spentMinor * 100n >= budgetMinor * warn && budgetMinor > 0n ? 'warning' : 'healthy';
  return { percentUsed, status };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export interface TransferAccount {
  id: string;
  userId: string;
  currency: string;
  status: 'active' | 'archived';
}

export interface TransferRequest {
  userId: string;
  from: TransferAccount;
  to: TransferAccount;
  amountMinor: bigint; // in source currency
  date: Date;
  transferGroupId: string;
  /** Required iff currencies differ. Decimal string: 1 `from` major unit = rate `to` major units. */
  rate?: string;
  /** Optional override of the destination amount for cross-currency transfers (e.g. actual bank result). */
  destinationAmountMinor?: bigint;
  /** If supplied, the source account must hold at least this balance after the transfer (>= 0 unless allowed). */
  sourceBalanceMinor?: bigint;
  allowOverdraft?: boolean;
  newId: () => string;
}

export interface TransferResult {
  out: LedgerEntry;
  in: LedgerEntry;
  conversion?: { rate: string; fromCurrency: string; toCurrency: string };
}

/** Builds BOTH sides of a transfer or throws; the caller persists them in one DB transaction. */
export function buildTransfer(r: TransferRequest): TransferResult {
  if (r.from.userId !== r.userId || r.to.userId !== r.userId) {
    throw new MoneyError('Both accounts must belong to the authenticated user');
  }
  if (r.from.id === r.to.id) throw new MoneyError('Source and destination must differ');
  if (r.from.status !== 'active' || r.to.status !== 'active') throw new MoneyError('Archived accounts cannot take part in transfers');
  assertPositiveMinor(r.amountMinor, 'Transfer amount');
  exponentOf(r.from.currency);
  exponentOf(r.to.currency);

  if (!r.allowOverdraft && r.sourceBalanceMinor !== undefined && r.sourceBalanceMinor < r.amountMinor) {
    throw new MoneyError('Insufficient funds in source account');
  }

  let destMinor = r.amountMinor;
  let conversion: TransferResult['conversion'];
  if (r.from.currency !== r.to.currency) {
    if (!r.rate) throw new MoneyError('Cross-currency transfers require an explicit conversion rate');
    destMinor = r.destinationAmountMinor ?? convertMinor(r.amountMinor, r.from.currency, r.to.currency, r.rate);
    assertPositiveMinor(destMinor, 'Converted amount');
    conversion = { rate: r.rate, fromCurrency: r.from.currency, toCurrency: r.to.currency };
  } else if (r.rate || r.destinationAmountMinor !== undefined) {
    throw new MoneyError('Conversion details are only valid for cross-currency transfers');
  }

  const base = { kind: 'transfer' as const, status: 'posted' as const, date: r.date, transferGroupId: r.transferGroupId };
  return {
    out: { ...base, id: r.newId(), accountId: r.from.id, direction: 'out', amountMinor: r.amountMinor, currency: r.from.currency },
    in: { ...base, id: r.newId(), accountId: r.to.id, direction: 'in', amountMinor: destMinor, currency: r.to.currency },
    conversion,
  };
}

// ---------------------------------------------------------------------------
// Reversals and refunds
// ---------------------------------------------------------------------------

/** Offsetting entry for a posted entry. The original must be marked `reversed` by the caller (only allowed mutation). */
export function buildReversal(original: LedgerEntry, newId: () => string, date: Date): LedgerEntry {
  if (original.status !== 'posted') throw new MoneyError('Only posted entries can be reversed');
  if (original.reversalOf) throw new MoneyError('A reversal entry cannot itself be reversed');
  return { ...original, id: newId(), status: 'posted', date, reversalOf: original.id };
}

/** Refund against an expense. Cannot exceed what has not yet been refunded. */
export function buildRefund(opts: {
  original: LedgerEntry;
  existingRefunds: readonly LedgerEntry[];
  amountMinor: bigint;
  date: Date;
  newId: () => string;
}): LedgerEntry {
  const { original, existingRefunds, amountMinor } = opts;
  if (original.kind !== 'expense' || original.status !== 'posted') throw new MoneyError('Only posted expenses can be refunded');
  assertPositiveMinor(amountMinor, 'Refund amount');
  const already = existingRefunds
    .filter((x) => x.refundOf === original.id && countsTowardsBalances(x))
    .reduce((s, x) => s + (x.reversalOf ? -x.amountMinor : x.amountMinor), 0n);
  if (already + amountMinor > original.amountMinor) throw new MoneyError('Refund exceeds the original expense');
  return {
    id: opts.newId(),
    accountId: original.accountId,
    kind: 'refund',
    status: 'posted',
    amountMinor,
    currency: original.currency,
    categoryId: original.categoryId,
    date: opts.date,
    refundOf: original.id,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function reconcile(args: BalanceInput & { statementBalanceMinor: bigint }) {
  const computedMinor = computeBalance(args);
  const differenceMinor = args.statementBalanceMinor - computedMinor;
  return { computedMinor, statementMinor: args.statementBalanceMinor, differenceMinor, reconciled: differenceMinor === 0n };
}
