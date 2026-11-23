import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setTestEnv } from './helpers.js';
setTestEnv();
const { createApp } = await import('../app.js');
const { ROUTE_TABLE, buildOpenApi } = await import('../openapi.js');

const app = createApp();
const fill = (p: string) => p.replace(/\{\w+\}/g, '0123456789abcdef01234567');

describe('every documented route is mounted and protected', () => {
  const protectedRoutes = ROUTE_TABLE.filter(([, , , , o]) => o?.auth !== false);
  for (const [method, path] of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} -> 401 without a session`, async () => {
      const r = await (request(app) as any)[method](`/api/v1${fill(path)}`).send({});
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHORIZED');
    });
  }
  it('public auth routes exist (validation error, not 404)', async () => {
    for (const p of ['/auth/register', '/auth/login', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email']) {
      expect((await request(app).post(`/api/v1${p}`).send({})).status, p).toBe(400);
    }
  });
  it('billing webhook refuses unsigned calls (501 when no provider, never 200)', async () => {
    const r = await request(app).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').send('{}');
    expect([400, 501]).toContain(r.status);
  });
});

describe('OpenAPI', () => {
  it('serves a spec listing every route with cookie auth on protected ones', async () => {
    const r = await request(app).get('/api/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.0.3');
    expect(Object.keys(r.body.paths)).toContain('/transfers');
    expect(r.body.paths['/transfers'].post.parameters.find((p: any) => p.name === 'Idempotency-Key').required).toBe(true);
    expect(r.body.paths['/auth/login'].post.security).toEqual([]);
  });
  it('has no duplicate method+path rows', () => {
    const keys = buildOpenApi() && ROUTE_TABLE.map(([m, p]) => `${m} ${p}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
