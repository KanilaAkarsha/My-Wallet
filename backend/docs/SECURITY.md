# SECURITY

Status legend: ✅ implemented + unit-tested · 🟡 implemented, needs MongoDB integration run · ⬜ not yet built

## Authentication & sessions
- ✅ Argon2id (m=19 MiB, t=2, p=1), rehash-on-login when parameters change; password 12–128 chars.
- ✅ Opaque 256-bit session id in an **HTTP-only** cookie (`Secure` in production / SameSite=None); only its SHA-256 is stored.
- 🟡 Session-bound **CSRF** token: returned in the login response body, kept in memory by the SPA (never localStorage), sent as `X-CSRF-Token`, compared against a stored hash in constant time. Required on every non-GET request.
- 🟡 Idle (7d, sliding) and absolute (30d) expiry; revoke one/all-others; rotation on login and password change; reset/change revokes all sessions.
- 🟡 Lockout: 5 failures → 15 min; plus IP rate limits. Unknown-user logins verify against a dummy hash (timing equalised). Same message for bad credentials/locked/unknown.
- 🟡 No account enumeration on register / forgot-password.
- 🟡 Email verification and reset tokens: 256-bit, stored hashed, expiring (24h / 30m), single use.
- ⬜ Optional 2FA (TOTP) — fields + AES-GCM primitive exist, endpoints pending.

## Data isolation
- `userId` comes only from the session. Request bodies are `.strict()` Zod schemas, so a client-supplied `userId`/`role` is rejected.
- `findOwned` / `assertAllOwned` / `ownedFilter` put `userId` in every query; foreign or malformed ids return **404** (no existence leak).
- Operator injection: `$`/`.` keys and `__proto__` are rejected at the edge (`rejectInjection`), schemas are `.strict()`, ids are validated. Mongoose `sanitizeFilter` is deliberately off: it rewrote the app's own `{ $gt: … }` queries into `{ $eq: … }` and caused a CastError on `/auth/me` (regression test in `database/queries.test.ts`).
- 🟡 Cross-user tests are written (`auth.integration.test.ts`); receipts/reports/transactions endpoints arrive with their modules and must add the same tests.

## API hardening
✅ Helmet (CSP `default-src 'none'`), strict single-origin CORS with credentials, 100 kb body limit, global + auth + email-endpoint rate limits, request ids, request timeout, JSON errors without stack/driver details.

## Privacy
- ✅ pino redaction for credentials, cookies, and financial fields; request bodies/queries are never logged.
- ✅ Audit log stores ids/actions only (IP truncated to /24), no amounts or descriptions.
- ✅ AES-256-GCM field encryption (AAD-bound to owner, key ids for rotation). **Only used for 2FA secrets (pending).** Transaction text and balances are **not** application-encrypted; protection relies on Atlas encryption at rest + TLS. Do not claim otherwise.
- ⬜ Data export, account deletion, retention jobs, receipt upload (planned).

## Known limitations
- No mail transport yet: production sends nothing (documented in `mailer.ts`).
- Rate limiting uses the in-memory store; move to Redis store before running >1 instance.
- CSRF/cookie setup assumes SPA and API on the same site or `COOKIE_SAMESITE=none` over HTTPS.
- Dependency audit and a formal security review are Phase 8.

## Additions since Phase 1
- TOTP 2FA with replay protection and hashed one-time recovery codes; secrets encrypted with AES-256-GCM (AAD-bound, key IDs).
- Attachments: raw-body upload, magic-byte sniffing (declared type is ignored), 5 MB cap, ownership-checked download, never served from a public path.
- Billing webhook uses raw body + signature verification; plan state changes only via verified webhooks (never from the client).
- CSV export neutralises spreadsheet formula injection. Admin endpoints expose account metadata only and write an audit log.
- Swagger UI/OpenAPI are disabled in production unless `ENABLE_API_DOCS=true`.
- Known gaps: rate-limit Redis store verified only against a fake client; no external penetration test has been performed; SMTP and Stripe integrations are unverified against live services.

## Google sign-in
- OpenID Connect authorization-code flow with PKCE (S256), `state` and `nonce`. State/nonce/verifier live in a short-lived, HMAC-signed, HTTP-only cookie scoped to `/api/v1/auth/google`.
- The ID token comes straight from Google's token endpoint (back channel); `iss`, `aud`, `exp`, `nonce` and `email_verified === true` are all checked. Unverified Google emails are refused.
- Linking: an existing password account with the same Google-verified email is linked. If that account's email was never verified, its password is replaced and its sessions revoked (prevents pre-registration takeover).
- Accounts with 2FA enabled cannot use Google sign-in (must use password + authenticator code). Suspended/deleted accounts are refused.
- After the redirect the SPA collects its CSRF token once via `GET /auth/csrf` (only while the session is flagged `csrfPending`).
- Not tested against live Google (no credentials in the authoring sandbox); the helpers are unit-tested.
