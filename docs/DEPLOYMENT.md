# DEPLOYMENT

## Local
```bash
cp .env.example .env            # fill the three secrets: openssl rand -hex 32
docker compose up -d mongo redis
npm install
npm run dev:backend
```
The compose `mongo` service runs a single-node **replica set** (`rs0`) — required for multi-document transactions (transfers). A standalone `mongod` will make the server refuse to start (`assertTransactionsSupported`).

Run the full suite including MongoDB tests:
```bash
MONGODB_TEST_URI='mongodb://localhost:27017/mywallet_test?replicaSet=rs0&directConnection=true' npm test
```

## Production (outline — not yet exercised)
- **MongoDB Atlas** M10+ (replica set by default; enable backups/PITR, encryption at rest, IP allow-list).
- **Redis** (managed) — required in production by env validation.
- **API** on Render (or similar) from `docker/server.Dockerfile`; set every var in `.env.example`; `NODE_ENV=production`, `APP_ORIGIN=https://…`. If the SPA (Vercel) and API are on different sites use `COOKIE_SAMESITE=none`.
- Separate dev/staging/prod databases and secrets; never commit `.env`.
- Mail transport and payment provider are **not configured/implemented yet**.

## Backup & restore
Atlas continuous backup + PITR; test a restore into staging before pilot. Documented procedure to be completed in Phase 8.

## Client container (added)
`docker compose up --build` now also builds `docker/client.Dockerfile` (Vite build served by nginx on :8080, proxying `/api/` to the server so cookies stay same-origin). Set `APP_ORIGIN=http://localhost:8080` in `.env` for local compose use; production must be https. These Dockerfiles were **not built in the authoring sandbox** (no Docker daemon) — check the first build.

## Mail
Set `SMTP_URL` (e.g. `smtps://user:pass@host:465`) and `EMAIL_FROM`. Without it production sends no email; with `REQUIRE_EMAIL_VERIFICATION` on (default in production) users cannot log in until verified, so configure SMTP before launch.

## Indexes
Mongoose `autoIndex` is dev-only. In production run the index build once on deploy (`cd backend && npm run db:sync-indexes`) before serving traffic; unique indexes (idempotency keys, reversals, recurring occurrences) are correctness-critical.
