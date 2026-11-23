# MyWallet API

Base path `/api/v1`. **Generated from `backend/src/openapi.ts`** (the live spec is at `/api/v1/openapi.json` and Swagger UI at `/api/v1/docs` outside production).

## Conventions
- Auth: HTTP-only cookie `mw_sid`; non-GET requests send `X-CSRF-Token` (returned in the login body).
- Money: decimal strings (`"1250.50"`); stored as integer minor units.
- Errors: `{ "error": { "code", "message", "details?", "requestId" } }`. Records of other users return 404.
- `Idempotency-Key` header: **required** on transfers, goal contributions, debt payments; optional on other money-creating POSTs. Same key + same body replays the original response; same key + different body → 409.
- Plan limits return 402 `PLAN_LIMIT`; unconfigured payments return 501 `NOT_CONFIGURED`.
- Lists use cursor pagination (`limit`, `cursor` → `nextCursor`).

## Auth

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| POST | `/auth/register` | public |  | Register (202 whether or not the email exists) |
| POST | `/auth/verify-email` | public |  | Verify email with token |
| POST | `/auth/login` | public |  | Log in; sets HTTP-only cookie, returns csrfToken (send TOTP code as `totp` when 2FA is on) |
| POST | `/auth/logout` | session |  | Log out |
| POST | `/auth/forgot-password` | public |  | Request reset email (always 202) |
| POST | `/auth/reset-password` | public |  | Reset password; revokes all sessions |
| GET | `/auth/me` | session |  | Current user |
| POST | `/auth/change-password` | session |  | Change password; rotates session |
| GET | `/auth/sessions` | session |  | List my sessions |
| DELETE | `/auth/sessions/{id}` | session |  | Revoke one session |
| POST | `/auth/sessions/revoke-others` | session |  | Revoke all other sessions |
| POST | `/auth/2fa/setup` | session |  | Start TOTP setup |
| POST | `/auth/2fa/enable` | session |  | Confirm TOTP, returns recovery codes once |
| POST | `/auth/2fa/disable` | session |  | Disable TOTP (password + code) |

## Profile

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/profile` | session |  | Get profile and preferences |
| PATCH | `/profile` | session |  | Update profile, preferences, privacy, theme, balance visibility |
| POST | `/profile/onboarding` | session | optional | Complete onboarding (all fields optional) |
| GET | `/profile/export` | session |  | Export all my data (JSON) |
| POST | `/profile/delete-account` | session |  | Close account; data erased after retention window |

## Planner

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/planner` | session |  | Student / young-professional planning view (limits, semester, salary split, emergency fund) |
| PUT | `/planner` | session |  | Save planning inputs |

## Accounts

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/accounts` | session |  | List accounts with computed balances |
| POST | `/accounts` | session |  | Create account |
| GET | `/accounts/{id}` | session |  | Get account |
| PATCH | `/accounts/{id}` | session |  | Update account |
| POST | `/accounts/{id}/archive` | session |  | Archive account |
| POST | `/accounts/{id}/unarchive` | session |  | Unarchive account |
| POST | `/accounts/{id}/reconcile` | session |  | Reconcile with a statement balance |

## Categories

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/categories` | session |  | List system + custom categories |
| POST | `/categories` | session |  | Create custom category |
| PATCH | `/categories/{id}` | session |  | Update custom category |
| DELETE | `/categories/{id}` | session |  | Archive custom category |

## Transactions

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/transactions` | session |  | List (cursor pagination, filters, search) |
| POST | `/transactions` | session | optional | Create income/expense/refund/adjustment |
| GET | `/transactions/{id}` | session |  | Get transaction |
| GET | `/transactions/{id}/template` | session |  | Prefill data from an earlier transaction (creates nothing) |
| PATCH | `/transactions/{id}` | session |  | Edit draft (pending) fully; posted: metadata only |
| POST | `/transactions/{id}/post` | session |  | Post a pending transaction |
| DELETE | `/transactions/{id}` | session |  | Delete an unposted transaction |
| POST | `/transactions/{id}/reverse` | session | optional | Reverse a posted transaction (offsetting entry) |

## Transfers

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/transfers` | session |  | Transfer history |
| POST | `/transfers` | session | required | Atomic transfer between own accounts |
| POST | `/transfers/{groupId}/reverse` | session | optional | Reverse both legs atomically |

## Budgets

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/budgets` | session |  | List budgets with usage |
| POST | `/budgets` | session |  | Create budget |
| GET | `/budgets/{id}` | session |  | Budget with history |
| PATCH | `/budgets/{id}` | session |  | Update budget |
| POST | `/budgets/{id}/archive` | session |  | Archive budget |
| DELETE | `/budgets/{id}` | session |  | Delete budget |

## Goals

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/goals` | session |  | List savings goals (Plus+) |
| POST | `/goals` | session |  | Create goal |
| GET | `/goals/{id}` | session |  | Goal with contributions |
| PATCH | `/goals/{id}` | session |  | Update goal |
| POST | `/goals/{id}/archive` | session |  | Archive goal |
| POST | `/goals/{id}/contributions` | session | required | Contribute or withdraw |

## Debts

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/debts` | session |  | List debts |
| POST | `/debts` | session | optional | Create debt/loan |
| GET | `/debts/{id}` | session |  | Debt with payment history |
| PATCH | `/debts/{id}` | session |  | Update debt |
| POST | `/debts/{id}/accrue` | session |  | Accrue interest to today |
| POST | `/debts/{id}/payments` | session | required | Record payment (interest first) |
| POST | `/debts/{id}/archive` | session |  | Archive debt |

## Bills

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/bills` | session |  | List bills |
| POST | `/bills` | session |  | Create bill |
| PATCH | `/bills/{id}` | session |  | Update bill |
| POST | `/bills/{id}/pay` | session | optional | Pay current occurrence |
| GET | `/bills/{id}/history` | session |  | Payment history |
| DELETE | `/bills/{id}` | session |  | Delete bill |

## Recurring

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/recurring` | session |  | List recurring transactions (Plus+) |
| POST | `/recurring` | session |  | Create recurring transaction |
| PATCH | `/recurring/{id}` | session |  | Update |
| DELETE | `/recurring/{id}` | session |  | Delete |
| POST | `/recurring/run` | session |  | Generate due occurrences now (idempotent) |

## Subscriptions

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/subscriptions` | session |  | List subscriptions with totals (Plus+) |
| POST | `/subscriptions` | session |  | Create |
| PATCH | `/subscriptions/{id}` | session |  | Update |
| POST | `/subscriptions/{id}/cancel` | session |  | Mark cancelled (records only; does not cancel with the provider) |
| POST | `/subscriptions/{id}/reactivate` | session |  | Mark active |
| POST | `/subscriptions/{id}/record-payment` | session | optional | Record a charge and advance the date |
| DELETE | `/subscriptions/{id}` | session |  | Delete |

## Notifications

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/notifications` | session |  | List notifications |
| POST | `/notifications/read-all` | session |  | Mark all read |
| POST | `/notifications/{id}/read` | session |  | Mark one read |
| POST | `/notifications/scan` | session |  | Run the reminder scan now (idempotent) |

## Dashboard

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/dashboard` | session |  | Dashboard summary for a date range |

## Reports

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/reports` | session |  | Available reports for my plan |
| GET | `/reports/{name}` | session |  | Run a report (json | csv | pdf) |
| GET | `/reports/transactions.csv` | session |  | Stream full transaction history as CSV |

## Insights

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/insights` | session |  | List insights (Premium) |
| POST | `/insights/refresh` | session |  | Compute insights now |
| POST | `/insights/{id}/dismiss` | session |  | Dismiss insight |

## Attachments

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| POST | `/attachments` | session |  | Upload receipt/image (raw body, sniffed, ≤5 MB) |
| GET | `/attachments/{id}` | session |  | Download (ownership-checked) |
| DELETE | `/attachments/{id}` | session |  | Delete attachment |

## Billing

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/billing` | session |  | Plan, usage, plans, payment history |
| POST | `/billing/trial` | session |  | Start a free trial (no payment) |
| POST | `/billing/checkout` | session |  | Start provider checkout (501 if no provider configured) |
| POST | `/billing/cancel` | session |  | Cancel plan |
| POST | `/billing/downgrade` | session |  | Downgrade plan |
| POST | `/billing/webhook` | public |  | Payment provider webhook (signature verified) |

## Admin

| Method | Path | Auth | Idempotency | Summary |
|---|---|---|---|---|
| GET | `/admin/stats` | session |  | Platform statistics (no financial data) |
| GET | `/admin/users` | session |  | List users (account metadata only) |
| PATCH | `/admin/users/{id}/status` | session |  | Suspend / reactivate |
| PATCH | `/admin/users/{id}/role` | session |  | Change role (super admin) |
| GET | `/admin/audit` | session |  | Audit log |
