// Run: k6 run -e BASE=http://localhost:4000 -e EMAIL=... -e PASSWORD=... load/k6-smoke.js
// Results are only meaningful from YOUR environment; none are recorded in this repo.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { stages: [{ duration: '30s', target: 20 }, { duration: '1m', target: 20 }, { duration: '10s', target: 0 }], thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800'] } };
const BASE = __ENV.BASE || 'http://localhost:4000/api/v1';

export function setup() {
  const r = http.post(`${BASE}/auth/login`, JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'login ok': (x) => x.status === 200 });
  return { csrf: r.json('csrfToken') };
}

export default function () {
  const dash = http.get(`${BASE}/dashboard`);
  check(dash, { 'dashboard 200': (r) => r.status === 200 });
  const tx = http.get(`${BASE}/transactions?limit=25`);
  check(tx, { 'transactions 200': (r) => r.status === 200 });
  sleep(1);
}
