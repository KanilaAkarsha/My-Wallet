# MyWallet — Own Your Money. Build Your Future.

MERN-stack personal finance app (MongoDB, Express, React, Node), TypeScript throughout.
`backend/` and `frontend/` are **two independent projects** — each has its own `package.json`, dependencies, `.env`, Dockerfile and README.

```
mywallet/
├── backend/            API (Express + Mongoose) — see backend/README.md
│   ├── src/  docs/  load/  Dockerfile  .env.example
├── frontend/           Web app (React + Vite) — see frontend/README.md
│   ├── src/  e2e/  nginx.conf  Dockerfile  .env.example
├── docs/               Project-level: PROGRESS, IMPLEMENTATION_PLAN, DEPLOYMENT
├── docker-compose.yml  MongoDB (replica set) + Redis + both apps
└── .github/workflows/ci.yml
```

## Run (three terminals, starting from the `mywallet` folder)
```bash
# 1. databases (Docker Desktop must be running)
docker compose up mongo redis

# 2. backend
cd backend && cp .env.example .env     # set the 3 secrets with: openssl rand -hex 32
npm install && npm run dev             # http://localhost:4000

# 3. frontend
cd frontend && cp .env.example .env
npm install && npm run dev             # http://localhost:5173
```
Everything in Docker instead: `cp backend/.env.example backend/.env`, set the secrets and `APP_ORIGIN=http://localhost:8080`, then `docker compose up --build` and open http://localhost:8080.

Status of what is tested and what is not: `docs/PROGRESS.md`.

## Google login (optional)
1. Go to https://console.cloud.google.com/apis/credentials → **Create credentials → OAuth client ID** → type **Web application** (configure the consent screen first if asked).
2. Add this **Authorized redirect URI** (exactly): `http://localhost:5173/api/v1/auth/google/callback` (for Docker: `http://localhost:8080/api/v1/auth/google/callback`).
3. Put the client ID and secret in `backend/.env`: `GOOGLE_CLIENT_ID=…` and `GOOGLE_CLIENT_SECRET=…`, then restart the backend.
4. The "Continue with Google" button appears on the login and register pages. For a published app use your https domain in both Google and `APP_ORIGIN`.
