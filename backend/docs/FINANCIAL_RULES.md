# FINANCIAL RULES

Implemented in `backend/src/services/finance/` (pure functions, no I/O). Every rule below has a test in `finance.test.ts`.

## Money
- Integer **minor units** as `BigInt` (stored as int64). No floats anywhere in finance code.
- **LKR: 2 decimal places** (1 LKR = 100 minor units). Other exponents: JPY 0, KWD 3, others 2.
- User input is a decimal *string*; excess precision is rejected (never silently rounded).
- Derived amounts (FX conversion, interest) round **half away from zero**.
- Amounts on entries are always positive; direction comes from `kind`/`direction`.

## Statuses
| Status | Affects balances/reports |
|---|---|
| pending | No |
| posted | Yes |
| reversed | Yes — it is cancelled by its posted reversal entry (net zero) |
| failed | No |

Posted records are immutable (amount, date, account, type, currency locked). Corrections are **reversal entries** (`reversalOf`), and the original's only permitted mutation is `posted → reversed`. A reversal cannot itself be reversed.

## Balance
`opening + income + refunds + incoming transfers − expenses − loan interest − outgoing transfers ± adjustments`. Entries in another currency than the account are an error, never summed.

## Rules (spec §8) → implementation
1. Transfers are not income / 2. not expenses — excluded from period totals and budgets.
3. Savings allocations are not expenses — *account-side linking lands in Phase 4*.
4. Borrowed money is not income — *debt creation flow lands in Phase 4*; no income entry is created.
5. Principal repayments reduce the liability (`allocateDebtPayment`), are not expenses.
6. Loan interest is an expense (`loan_interest` kind).
7. Refunds credit the account and reduce expenses; cannot exceed the unrefunded amount.
8. Pending does not affect balances.
9. Recurring duplicates — unique index on `(userId, scheduleId, occurrenceDate)`; generator in Phase 5.
10. Reconciliation returns computed vs statement balance and the difference.

## Transfers
Both legs built together (`buildTransfer`), sharing `transferGroupId`; owner check on both accounts, distinct, active, positive amount, optional funds check. Cross-currency requires an explicit decimal rate (and optionally the actual destination amount); the conversion is recorded. Persistence must use `withTransaction` (needs a replica set) — wired in Phase 2.

## Budgets
Spent = posted expenses + loan interest − refunds in the period and categories (reversals negate). Status: `healthy` < warn% (default 80) ≤ `warning` ≤ 100% < `exceeded`.

## Debt
Simple interest: `principal × bps × days / (10000 × 365)`. Periodic: `outstanding × bps / (10000 × periodsPerYear)`. Payments settle accrued interest first.
