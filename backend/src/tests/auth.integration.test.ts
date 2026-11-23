/**
 * Integration tests against a REAL MongoDB. Skipped unless MONGODB_TEST_URI is set
 * (use the docker-compose mongo service: mongodb://localhost:27017/mywallet_test?replicaSet=rs0).
 * They are part of the Phase 1 acceptance gate and run in CI.
 */
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTestEnv } from './helpers.js';

const URI = process.env.MONGODB_TEST_URI;
setTestEnv();

describe.skipIf(!URI)('auth + isolation (MongoDB)', () => {
  let app: import('express').Express;
  let links: Record<string, string> = {};
  const PW = 'a-very-long-password-1';

  beforeAll(async () => {
    const { connectDatabase } = await import('../database/connection.js');
    const { createApp } = await import('../app.js');
    const { setMailer } = await import('../modules/auth/mailer.js');
    await connectDatabase();
    const models = await import('../database/models/index.js');
    await Promise.all(Object.values(models).map((m) => ('syncIndexes' in m ? (m as mongoose.Model<unknown>).syncIndexes() : undefined)));
    setMailer({ send: async ({ to, devLink }) => void (links[to] = devLink ?? '') });
    app = createApp();
  });
  beforeEach(async () => {
    links = {};
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  const tokenFrom = (email: string) => new URL(links[email]!).searchParams.get('token')!;
  async function signUp(email: string) {
    await request(app).post('/api/v1/auth/register').send({ email, password: PW }).expect(202);
    await request(app).post('/api/v1/auth/verify-email').send({ token: tokenFrom(email) }).expect(200);
    const agent = request.agent(app);
    const r = await agent.post('/api/v1/auth/login').send({ email, password: PW }).expect(200);
    return { agent, csrf: r.body.csrfToken as string };
  }

  it('register -> verify -> login -> me -> logout (CSRF enforced) -> session dead', async () => {
    const email = 'a@example.com';
    await request(app).post('/api/v1/auth/register').send({ email, password: PW }).expect(202);
    await request(app).post('/api/v1/auth/login').send({ email, password: PW }).expect(403); // unverified
    await request(app).post('/api/v1/auth/verify-email').send({ token: tokenFrom(email) }).expect(200);

    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email, password: PW }).expect(200);
    const cookie = login.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(login.body)).not.toContain('mw_sid');

    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').expect(403); // no CSRF header
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', 'wrong'.repeat(10)).expect(403);
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', login.body.csrfToken).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('does not reveal whether an email is registered (register, login, forgot)', async () => {
    await signUp('exists@example.com');
    const dup = await request(app).post('/api/v1/auth/register').send({ email: 'exists@example.com', password: PW });
    const fresh = await request(app).post('/api/v1/auth/register').send({ email: 'new@example.com', password: PW });
    expect(dup.status).toBe(fresh.status);
    expect(dup.body).toEqual(fresh.body);
    const bad1 = await request(app).post('/api/v1/auth/login').send({ email: 'exists@example.com', password: 'nope-nope-nope-1' });
    const bad2 = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope-1' });
    expect([bad1.status, bad1.body.error.message]).toEqual([bad2.status, bad2.body.error.message]);
    const f1 = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'exists@example.com' });
    const f2 = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(f1.status).toBe(f2.status);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    await signUp('lock@example.com');
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: 'lock@example.com', password: 'wrong-wrong-wrong' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'lock@example.com', password: PW }).expect(401);
  });

  it('password reset is single-use and revokes all sessions', async () => {
    const { agent } = await signUp('reset@example.com');
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'reset@example.com' }).expect(202);
    const token = tokenFrom('reset@example.com');
    await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'brand-new-password-2' }).expect(200);
    await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'another-password-3' }).expect(400);
    await agent.get('/api/v1/auth/me').expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'reset@example.com', password: 'brand-new-password-2' }).expect(200);
  });

  it('users can list and revoke their own sessions but never another user’s', async () => {
    const a = await signUp('sa@example.com');
    const b = await signUp('sb@example.com');
    const bSessions = await b.agent.get('/api/v1/auth/sessions').expect(200);
    const bSessionId = bSessions.body.sessions[0].id as string;
    await a.agent.delete(`/api/v1/auth/sessions/${bSessionId}`).set('X-CSRF-Token', a.csrf).expect(404);
    await b.agent.get('/api/v1/auth/me').expect(200); // still alive
  });

  it('ownership helpers: user A cannot load, or reference, user B’s documents', async () => {
    const { Account, User } = await import('../database/models/index.js');
    const { findOwned, assertAllOwned } = await import('../shared/ownership.js');
    const ua = await User.create({ email: 'oa@example.com', passwordHash: 'x' });
    const ub = await User.create({ email: 'ob@example.com', passwordHash: 'x' });
    const accB = await Account.create({ userId: ub._id, name: 'B cash', type: 'cash', currency: 'LKR', openingBalanceMinor: 100n });
    await expect(findOwned(Account, String(ua._id), String(accB._id), 'Account')).rejects.toMatchObject({ status: 404 });
    await expect(assertAllOwned(Account, String(ua._id), [String(accB._id)], 'Account')).rejects.toMatchObject({ status: 404 });
    await expect(findOwned(Account, String(ub._id), String(accB._id), 'Account')).resolves.toBeTruthy();
    await expect(findOwned(Account, String(ua._id), new Types.ObjectId().toHexString(), 'Account')).rejects.toMatchObject({ status: 404 });
  });

  it('posted transactions are immutable; only posted -> reversed is allowed', async () => {
    const { Account, Transaction, User } = await import('../database/models/index.js');
    const u = await User.create({ email: 'imm@example.com', passwordHash: 'x' });
    const acc = await Account.create({ userId: u._id, name: 'Cash', type: 'cash', currency: 'LKR', openingBalanceMinor: 0n });
    const tx = await Transaction.create({
      userId: u._id, accountId: acc._id, type: 'expense', status: 'posted', title: 'Lunch',
      amountMinor: 1500n, currency: 'LKR', transactionDate: new Date(),
    });
    tx.amountMinor = 9999n;
    await expect(tx.save()).rejects.toThrow(/immutable/);
    const fresh = await Transaction.findById(tx._id);
    fresh!.title = 'Lunch (edited note)'; // metadata edits stay allowed
    await expect(fresh!.save()).resolves.toBeTruthy();
    fresh!.status = 'pending';
    await expect(fresh!.save()).rejects.toThrow(/status transition/);
  });

  it('idempotency key unique index blocks duplicate writes per user', async () => {
    const { Account, Transaction, User } = await import('../database/models/index.js');
    const u = await User.create({ email: 'idem@example.com', passwordHash: 'x' });
    const acc = await Account.create({ userId: u._id, name: 'Cash', type: 'cash', currency: 'LKR', openingBalanceMinor: 0n });
    const doc = { userId: u._id, accountId: acc._id, type: 'income', status: 'posted', title: 'Pay', amountMinor: 100n, currency: 'LKR', transactionDate: new Date(), idempotencyKey: 'k-1' };
    await Transaction.create(doc);
    await expect(Transaction.create(doc)).rejects.toMatchObject({ code: 11000 });
  });
});
