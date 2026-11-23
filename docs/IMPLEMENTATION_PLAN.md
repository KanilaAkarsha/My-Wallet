# MyWallet — Implementation Plan (as built)

## Architecture
- **Monorepo** (npm workspaces): `backend/` (Express + TypeScript strict + Mongoose), `frontend/` (Vite + React + TS + Tailwind + Radix).
- **Money**: integer minor units (BigInt), decimal strings at the API boundary, half-away-from-zero rounding, explicit-rate FX. No floats in ledger code (`backend/src/services/finance`).
- **Ledger**: posted records are immutable (only posted→reversed); corrections are offsetting entries; transfers are atomic two-leg writes in a Mongo transaction (replica set required); idempotency keys on money-creating POSTs.
- **Aggregation**: Mongo `$group` by `{kind, direction, reversal}` folded in JS; proven equal to the entry-level engine by a property test.
- **Security**: Argon2id, opaque session cookie (hash stored), session-bound CSRF, lockout, TOTP 2FA + recovery codes, AES-256-GCM field encryption, strict Zod validation, operator-injection rejection, Helmet/CORS/rate limits, redacted logs. See `SECURITY.md`.
- **Plans**: free/plus/premium; limits block only *new* items or the report window — history is never hidden.
- **Jobs**: BullMQ (recurring, notification scan, insights, monthly summary, retention purge), all idempotent; no-op without Redis.

## Phases and status
| # | Phase | Status |
|---|---|---|
| 1 | Foundation, financial engine, schemas, auth + security | Done; engine/security **tested** |
| 2 | Accounts, categories, transactions, transfers | Handlers written; **not run vs MongoDB** |
| 3 | Budgets, goals, debts, bills, recurring, subscriptions | Handlers written; maths **tested**, routes not run |
| 4 | Dashboard, reports (CSV/PDF), insights, notifications, planner | Maths/export **tested**; routes not run |
| 5 | Profile/data export/deletion, attachments, billing, admin, SMTP | Written; provider/mailer **unit-tested**; not run live |
| 6 | Wiring, OpenAPI, jobs | Done; route coverage **tested** |
| 7 | Client app (all routes, design system, mobile UX) | Builds, typechecks, 8 tests; **never run vs live API** |
| 8 | Hardening: Mongo integration run, Playwright, k6, audit | **Not done** — needs a database; scripts provided |

## Verification still required (cannot be done in the build sandbox)
1. `docker compose up`; run `cd backend && npm test` with `MONGODB_TEST_URI` (replica set).
2. Walk the client against the API; fix response-shape mismatches.
3. `cd frontend && npx playwright test` (desktop + mobile projects) against the running stack.
4. `k6 run backend/load/k6-smoke.js` in your environment; record your own numbers.
5. Verify Stripe (incl. LKR support) with test keys before enabling payments; configure SMTP.
