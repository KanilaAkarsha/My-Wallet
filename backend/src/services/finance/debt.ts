/**
 * Debt maths. Rules: interest is an EXPENSE; principal repayment reduces the liability and is
 * NOT an expense. Borrowing is NOT income (it increases both an account and a liability).
 */
import { MoneyError, assertPositiveMinor, divRound } from './money.js';

/** Simple interest accrued over `days` on `principalMinor` at `annualRateBps` (basis points per year, 365-day basis). */
export function accrueSimpleInterest(principalMinor: bigint, annualRateBps: bigint, days: number): bigint {
  if (!Number.isInteger(days) || days < 0) throw new MoneyError('Days must be a non-negative integer');
  if (principalMinor < 0n || annualRateBps < 0n) throw new MoneyError('Principal and rate must be non-negative');
  return divRound(principalMinor * annualRateBps * BigInt(days), 10000n * 365n);
}

/** Interest for one period of a reducing-balance loan with `periodsPerYear` periods. */
export function periodicInterest(outstandingMinor: bigint, annualRateBps: bigint, periodsPerYear: number): bigint {
  if (!Number.isInteger(periodsPerYear) || periodsPerYear <= 0) throw new MoneyError('periodsPerYear must be a positive integer');
  return divRound(outstandingMinor * annualRateBps, 10000n * BigInt(periodsPerYear));
}

export interface PaymentAllocation {
  interestMinor: bigint; // recorded as an expense
  principalMinor: bigint; // reduces the liability, not an expense
  newOutstandingPrincipalMinor: bigint;
  newAccruedInterestMinor: bigint;
}

/** Interest is settled first, the remainder reduces principal. Overpayment is rejected. */
export function allocateDebtPayment(opts: {
  outstandingPrincipalMinor: bigint;
  accruedInterestMinor: bigint;
  paymentMinor: bigint;
}): PaymentAllocation {
  const { outstandingPrincipalMinor: p, accruedInterestMinor: i, paymentMinor: pay } = opts;
  assertPositiveMinor(pay, 'Payment');
  if (p < 0n || i < 0n) throw new MoneyError('Outstanding balances cannot be negative');
  if (pay > p + i) throw new MoneyError('Payment exceeds total amount owed');
  const interestMinor = pay < i ? pay : i;
  const principalMinor = pay - interestMinor;
  return {
    interestMinor,
    principalMinor,
    newOutstandingPrincipalMinor: p - principalMinor,
    newAccruedInterestMinor: i - interestMinor,
  };
}
