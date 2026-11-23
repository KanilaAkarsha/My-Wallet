# MyWallet frontend

React + Vite + TypeScript + Tailwind app. Self-contained: its own `package.json`, `.env`, `Dockerfile`.

```bash
cp .env.example .env     # API_URL = backend address for the dev proxy (default http://localhost:4000)
npm install
npm run dev              # http://localhost:5173 (proxies /api to the backend)
npm test                 # component tests
npm run build            # production build in dist/
npx playwright test      # end-to-end; needs backend + databases running
```
The app calls the backend only through `/api/v1`; in production nginx (`nginx.conf`) proxies `/api/` to the backend.
