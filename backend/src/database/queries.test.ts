import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { setTestEnv } from '../tests/helpers.js';
setTestEnv();
const { configureMongoose } = await import('./connection.js');
const { Session, Transaction } = await import('./models/index.js');

/** Regression: with sanitizeFilter on, internal operator queries failed with CastError (broke /auth/me after login). */
describe('internal operator queries cast cleanly under the production Mongoose config', () => {
  configureMongoose();
  const now = new Date();
  const oid = new mongoose.Types.ObjectId();
  const cast = (q: any) => { q._castConditions(); return q.error?.() ?? null; };

  it('session lookup (the /auth/me path)', () => {
    expect(cast(Session.findOne({ tokenHash: 'x', revokedAt: null, expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now } }))).toBeNull();
  });
  it('range and set operators on ledger queries', () => {
    expect(cast(Transaction.find({ userId: oid, date: { $gte: now, $lt: now }, status: { $in: ['posted', 'reversed'] } }))).toBeNull();
  });
});
