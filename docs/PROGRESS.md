# MyWallet — Progress (honest status)

Legend: **Tested** = automated test executed and passing in the build sandbox. **Typechecked** = compiles under strict TS only. **Written, not run** = needs MongoDB/Redis/Docker, which the build sandbox did not have.

## Backend (backend/)
| Area | Status |
|---|---|
| Money engine (integer minor units, rounding, FX), ledger, debt maths, group-fold aggregation | **Tested** (finance 28, aggregate 6 incl. property test) |
| Recurrence/date ranges, goals maths, insights rules, CSV/PDF export, TOTP (RFC 6238 vectors), payment provider (webhook signatures) | **Tested** |
| Security middleware (headers, CORS, injection rejection, rate limit, CSRF, validation) | **Tested** (22) |
| Every documented route mounted + 401 when unauthenticated; OpenAPI spec served | **Tested** (routes.test.ts) |
| Auth, accounts, transactions, transfers, budgets, goals, debts, bills, recurring, subscriptions, notifications, dashboard, reports, insights, attachments, profile, billing, admin route handlers | **Typechecked, written, not run** against MongoDB |
| Mongo integration tests (auth flow: 8) | **Written, skipped** unless `MONGODB_TEST_URI` is set (replica set required) |
| BullMQ jobs, Redis cache | **Typechecked, not run** |

Totals in sandbox: server 189 passed / 8 skipped; client 8 passed.

## Frontend (frontend/)
All routes in spec §11 exist: auth, onboarding, dashboard, transactions (list/new/detail), income, expenses, accounts (+detail), transfers, categories, budgets (+new/detail), goals (+detail), debts (+detail), bills, recurring, subscriptions, reports, insights, notifications, settings (profile/preferences/security/billing/data), admin. Desktop sidebar + mobile bottom nav with floating quick-add, dark mode, balance-hide toggle.
Status: typechecks, production build succeeds, 8 RTL tests pass. **Never exercised against the live API** (no database in sandbox) — expect small response-shape mismatches on first run.
Playwright specs are written (e2e/) but were not executed.

## Known gaps (not built / not verified)
- Student & young-professional modes: `/planner` (weekly limit, monthly allowance, semester budget, 50/30/20 salary split, emergency-fund coverage) has tested pure maths (7 tests) but its endpoint and page were never run against a database.
- Email: SMTP transport via nodemailer when `SMTP_URL` is set (tested only with the in-memory JSON transport, never against a real SMTP server); without it dev logs links and prod sends nothing; Stripe adapter not verified against live Stripe (LKR support must be checked); no real bank connectivity (by design).
- Google sign-in: backend flow + button written, helpers unit-tested; never run against live Google (needs your OAuth client).
- Attachment UI (receipts on the transaction page) added; never run against the API. Goal images have no UI. Files are on local disk.
- Production indexes: run `cd backend && npm run db:sync-indexes` on deploy (script written, not run — needs MongoDB).
- Rate limits use a shared Redis store when `REDIS_URL` is set (unit-tested with a fake Redis only), else per-process memory.
- Transaction edit (drafts fully, posted: metadata only) and category rename UI added; still never run against the API.
- k6 script provided (`backend/load/k6-smoke.js`); **no performance numbers have been measured**.
- Client: dashboard/planner/admin/onboarding are lazy-loaded; main chunk ~470 kB (charts library dominates the dashboard chunk).
- Docs DATABASE_SCHEMA.md / API_DOCUMENTATION.md / IMPLEMENTATION_PLAN.md were written earlier and may lag the code; `/api/v1/openapi.json` is the authoritative route list.

## First run checklist
1. `docker compose up` (Mongo replica set + Redis + API), `cd frontend && npm run dev`.
2. Set `MONGODB_TEST_URI` and run `cd backend && npm test` to execute the integration tests.
3. Register, create account, add transactions; report any shape mismatch.

## Bill scanner (photos + PDFs)
- `/scan` page: camera capture or file upload (JPEG/PNG/WebP/PDF) → on-device text extraction → editable review form → saves an expense (idempotent) and attaches the original bill via the existing attachments API.
- Images: `tesseract.js` OCR after downscaling to ≤2000 px JPEG (keeps under the 5 MB cap). PDFs: `pdfjs-dist` text layer; scanned PDFs fall back to rendering ≤3 pages + OCR.
- Parser (`frontend/src/lib/billParser.ts`) is heuristic: merchant, date (day-first), total (prefers "total/amount due" lines), line items, category hint. Unit-tested (7 tests).
- **Not verified**: real tesseract OCR and pdf.js rendering were not run end-to-end here (the sandbox cannot fetch the OCR language data and has no real bills). Accuracy on real Sri Lankan receipts is unknown; the user always reviews before saving. First scan downloads the English model from a CDN. Sinhala/Tamil receipts are not supported (English model only).
