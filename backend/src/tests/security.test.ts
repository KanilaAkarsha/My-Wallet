import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { parseEnv } from '../config/env.js';
import { createApp } from '../app.js';
import { hashPassword, verifyPassword } from '../modules/auth/password.js';
import { decryptField, encryptField, keyRingFromHex, randomToken, safeEqualHex, sha256Hex } from '../utils/crypto.js';
import { requireRole } from '../middleware/auth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { rejectInjection } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { assertObjectId, ownedFilter } from '../shared/ownership.js';
import { REDACT_PATHS } from '../shared/logger.js';
import { AppError } from '../shared/errors.js';
import { Account, Transaction } from '../database/models/index.js';
import { registerBody } from '../modules/auth/auth.schemas.js';
import { setTestEnv } from './helpers.js';

setTestEnv();

describe('environment validation', () => {
  const good = { MONGODB_URI: 'mongodb://x/y', SESSION_SECRET: 'a'.repeat(64), FIELD_ENCRYPTION_KEY: 'b'.repeat(64) };
  it('accepts a valid config and applies LKR / Asia/Colombo defaults', () => {
    const e = parseEnv(good as NodeJS.ProcessEnv);
    expect(e.DEFAULT_CURRENCY).toBe('LKR');
    expect(e.DEFAULT_TIMEZONE).toBe('Asia/Colombo');
  });
  it('rejects short/missing secrets', () => {
    expect(() => parseEnv({ ...good, SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ MONGODB_URI: 'x' } as NodeJS.ProcessEnv)).toThrow(/Invalid environment/);
  });
  it('refuses placeholder secrets, http origin and missing Redis in production', () => {
    expect(() =>
      parseEnv({ ...good, NODE_ENV: 'production', APP_ORIGIN: 'http://x.com', SESSION_SECRET: `replace-me${'0'.repeat(54)}` } as NodeJS.ProcessEnv),
    ).toThrow();
    expect(() => parseEnv({ ...good, NODE_ENV: 'production', APP_ORIGIN: 'https://x.com' } as NodeJS.ProcessEnv)).toThrow(/REDIS_URL/);
  });
});

describe('passwords (Argon2id)', () => {
  it('hashes with argon2id and verifies; wrong password fails', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
  it('produces unique salted hashes', async () => {
    expect(await hashPassword('same-password-12')).not.toBe(await hashPassword('same-password-12'));
  });
});

describe('tokens and field encryption', () => {
  it('random tokens are unique, long and URL-safe; hashes are deterministic', () => {
    const a = randomToken();
    expect(a).not.toBe(randomToken());
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex(a)).toBe(sha256Hex(a));
    expect(safeEqualHex(sha256Hex(a), sha256Hex(a))).toBe(true);
    expect(safeEqualHex(sha256Hex(a), sha256Hex('b'))).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });
  it('AES-256-GCM round-trips, never stores plaintext, and detects tampering / wrong context', () => {
    const ring = keyRingFromHex('k1', randomBytes(32).toString('hex'));
    const env = encryptField('JBSWY3DPEHPK3PXP', ring, 'user:1');
    expect(env).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptField(env, ring, 'user:1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptField(env, ring, 'user:2')).toThrow(); // AAD binds ciphertext to its owner
    const parts = env.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptField(parts.join('.'), ring, 'user:1')).toThrow();
  });
  it('supports key rotation: old key ids still decrypt', () => {
    const old = keyRingFromHex('k1', randomBytes(32).toString('hex'));
    const env = encryptField('secret', old);
    const rotated = { activeId: 'k2', keys: { ...old.keys, k2: randomBytes(32) } };
    expect(decryptField(env, rotated)).toBe('secret');
    expect(encryptField('x', rotated).split('.')[1]).toBe('k2');
  });
});

describe('HTTP hardening (no database needed)', () => {
  const app = createApp();

  it('sets security headers, request id, hides x-powered-by', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-request-id']).toBeTruthy();
  });
  it('requires authentication on protected routes, with a generic body', async () => {
    for (const path of ['/api/v1/auth/me', '/api/v1/auth/sessions']) {
      const r = await request(app).get(path);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHORIZED');
    }
    const logout = await request(app).post('/api/v1/auth/logout');
    expect(logout.status).toBe(401);
  });
  it('rejects garbage session cookies without touching the database', async () => {
    const r = await request(app).get('/api/v1/auth/me').set('Cookie', 'mw_sid=short');
    expect(r.status).toBe(401);
  });
  it('strict CORS: only the configured origin is allowed', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects oversized and malformed bodies with safe errors', async () => {
    const big = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/SyntaxError|at /);
  });
  it('validates input strictly (unknown keys, weak password, bad email)', async () => {
    const r1 = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email', password: 'x' });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/api/v1/auth/register').send({ email: 'a@b.co', password: 'a-long-enough-password', role: 'admin' });
    expect(r2.status).toBe(400); // .strict(): cannot smuggle role
    expect(registerBody.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
  });
  it('blocks NoSQL operator injection in body and query', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(r.status).toBe(400);
    const q = await request(app).get('/api/v1/auth/me?user[$ne]=x');
    expect(q.status).toBe(400);
  });
  it('unknown routes return a JSON 404, errors never leak internals', async () => {
    const r = await request(app).get('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.requestId).toBeTruthy();
  });
});

describe('middleware units', () => {
  it('rejectInjection / validate / requireRole / errorHandler behave', async () => {
    const a = express();
    a.use(express.json());
    a.use(rejectInjection);
    a.post('/v', validate({ body: registerBody }), (req, res) => void res.json(req.body));
    a.get('/admin', (req, _res, next) => { req.auth = { userId: 'u', sessionId: 's', role: 'user' }; next(); }, requireRole('admin'), (_q, r) => void r.send('ok'));
    a.get('/boom', () => { throw new Error('secret db detail mongodb://user:pass@host'); });
    a.get('/app', () => { throw new AppError(418, 'TEAPOT', 'short and stout'); });
    a.use(errorHandler);

    expect((await request(a).post('/v').send({ 'a.b': 1 })).status).toBe(400);
    expect((await request(a).post('/v').send({ __proto__: { x: 1 }, email: 'a@b.co', password: 'a-long-enough-password' })).status).not.toBe(500);
    expect((await request(a).get('/admin')).status).toBe(403);
    const boom = await request(a).get('/boom');
    expect(boom.status).toBe(500);
    expect(JSON.stringify(boom.body)).not.toContain('mongodb://');
    expect((await request(a).get('/app')).status).toBe(418);
  });
});

describe('ownership helpers', () => {
  it('overwrites any caller-supplied userId in filters', () => {
    expect(ownedFilter('me', { userId: 'someone-else', status: 'active' } as never)).toEqual({ userId: 'me', status: 'active' });
  });
  it('rejects malformed / non-string ids as not found (no CastError leaks, no operator objects)', () => {
    expect(() => assertObjectId('123')).toThrow(AppError);
    expect(() => assertObjectId({ $ne: null })).toThrow(AppError);
    expect(assertObjectId(new Types.ObjectId().toHexString())).toHaveLength(24);
  });
});

describe('logging redaction', () => {
  it('covers credentials and financial fields', () => {
    for (const p of ['req.headers.cookie', '*.password', '*.passwordHash', '*.amountMinor', '*.description', 'res.headers["set-cookie"]']) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
});

describe('schema-level validation (no database needed)', () => {
  const uid = new Types.ObjectId();
  it('transactions need a direction for transfers and a positive minor-unit amount', async () => {
    const t = new Transaction({ userId: uid, accountId: new Types.ObjectId(), type: 'transfer', title: 't', amountMinor: 100n, currency: 'LKR', transactionDate: new Date(), transferGroupId: 'g' });
    await expect(t.validate()).rejects.toThrow(/direction/); // pre('validate') hooks only run in async validate
    const zero = new Transaction({ userId: uid, accountId: new Types.ObjectId(), type: 'expense', title: 't', amountMinor: 0n, currency: 'LKR', transactionDate: new Date() });
    expect(zero.validateSync()?.errors['amountMinor']).toBeTruthy();
    const ok = new Transaction({ userId: uid, accountId: new Types.ObjectId(), type: 'expense', title: 't', amountMinor: 1250n, currency: 'LKR', transactionDate: new Date() });
    expect(ok.validateSync()).toBeUndefined();
  });
  it('rejects unknown currencies and unknown fields (strict: throw)', () => {
    const a = new Account({ userId: uid, name: 'Cash', type: 'cash', currency: 'XXX', openingBalanceMinor: 0n });
    expect(a.validateSync()?.errors['currency']).toBeTruthy();
    expect(() => new Account({ userId: uid, name: 'x', type: 'cash', currency: 'LKR', openingBalanceMinor: 0n, isAdmin: true })).toThrow();
  });
});
