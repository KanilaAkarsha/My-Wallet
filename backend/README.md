# MyWallet backend

Express + TypeScript (strict) + Mongoose API. Self-contained: its own `package.json`, `.env`, `Dockerfile`.

```bash
cp .env.example .env     # set SESSION_SECRET, CSRF_SECRET, FIELD_ENCRYPTION_KEY (openssl rand -hex 32 each)
npm install
npm run dev              # http://localhost:4000  (needs MongoDB replica set + optional Redis)
npm test                 # unit tests; set MONGODB_TEST_URI to also run the database tests
npm run build && npm start
npm run db:sync-indexes  # production: build indexes once per deploy
```
- API docs: `docs/API_DOCUMENTATION.md`, live OpenAPI at `/api/v1/openapi.json`, Swagger UI at `/api/v1/docs` (non-production).
- Other docs: `docs/DATABASE_SCHEMA.md`, `docs/FINANCIAL_RULES.md`, `docs/SECURITY.md`. Load test: `load/k6-smoke.js`.
- Local databases: from the repo root run `docker compose up mongo redis`.
