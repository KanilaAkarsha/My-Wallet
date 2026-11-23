import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, BillingSubscription, Profile, Session, Transaction, User } from '../../database/models/index.js';
import { authed, requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { escapeRegex, h, idParams, objectId, pageQuery, decodeCursor, encodeCursor } from '../../shared/http.js';
import { oid } from '../../database/models/common.js';

/**
 * Platform administration. By design this exposes ACCOUNT metadata and aggregate counts only —
 * never balances, transactions, descriptions or any user's financial records.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'superadmin'));

adminRouter.get('/stats', h(async (_req, res) => {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [users, active, suspended, newUsers, plans, txCount] = await Promise.all([
    User.countDocuments({ status: { $ne: 'deleted' } }), User.countDocuments({ status: 'active', lastLoginAt: { $gte: since30 } }), User.countDocuments({ status: 'suspended' }), User.countDocuments({ createdAt: { $gte: since30 } }),
    BillingSubscription.aggregate([{ $group: { _id: { plan: '$planCode', status: '$status' }, n: { $sum: 1 } } }]), Transaction.estimatedDocumentCount(),
  ]);
  res.json({ users, activeLast30Days: active, suspended, signupsLast30Days: newUsers, subscriptions: (plans as any[]).map((p) => ({ plan: p._id.plan, status: p._id.status, count: p.n })), totalTransactionsStored: txCount });
}));

adminRouter.get('/users', validate({ query: pageQuery.extend({ q: z.string().trim().max(80).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional() }) }), h(async (req, res) => {
  const q = req.query as any;
  const cur = decodeCursor(q.cursor);
  const f: Record<string, unknown> = {};
  if (q.status) f.status = q.status;
  if (q.q) f.email = { $regex: escapeRegex(q.q.toLowerCase()) };
  if (cur) f.$or = [{ createdAt: { $lt: cur.d } }, { createdAt: cur.d, _id: { $lt: oid(cur.i) } }];
  const rows: any[] = await User.find(f).select('email role status createdAt lastLoginAt emailVerifiedAt').sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean();
  const more = rows.length > q.limit;
  const page = more ? rows.slice(0, q.limit) : rows;
  const subs: any[] = await BillingSubscription.find({ userId: { $in: page.map((u) => u._id) } }).select('userId planCode status').lean();
  const sm = new Map(subs.map((s) => [String(s.userId), s]));
  const last = page[page.length - 1];
  res.json({ items: page.map((u) => ({ id: String(u._id), email: u.email, role: u.role, status: u.status, emailVerified: !!u.emailVerifiedAt, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt ?? null, plan: sm.get(String(u._id))?.planCode ?? 'free' })), nextCursor: more && last ? encodeCursor(last.createdAt, last._id) : null });
}));

adminRouter.patch('/users/:id/status', validate({ params: idParams, body: z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(300).optional() }).strict() }), h(async (req, res) => {
  const a = authed(req);
  if (req.params.id === a.userId) throw badRequest('You cannot change your own status');
  const u: any = await User.findById(req.params.id).select('role status');
  if (!u || u.status === 'deleted') throw badRequest('User not found');
  if (u.role !== 'user' && a.role !== 'superadmin') throw forbidden('Only a super admin can change an admin');
  u.status = req.body.status;
  await u.save();
  if (req.body.status === 'suspended') await Session.updateMany({ userId: u._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await AuditLog.create({ userId: u._id, actorRole: a.role, action: `admin.user_${req.body.status}`, entity: 'user', entityId: u._id, requestId: req.id, meta: { by: a.userId, reason: req.body.reason } });
  res.json({ id: String(u._id), status: u.status });
}));

adminRouter.patch('/users/:id/role', requireRole('superadmin'), validate({ params: idParams, body: z.object({ role: z.enum(['user', 'admin']) }).strict() }), h(async (req, res) => {
  const a = authed(req);
  if (req.params.id === a.userId) throw badRequest('You cannot change your own role');
  const u: any = await User.findById(req.params.id).select('role');
  if (!u || u.role === 'superadmin') throw badRequest('Cannot change this user');
  u.role = req.body.role;
  await u.save();
  await Session.updateMany({ userId: u._id, revokedAt: null }, { $set: { revokedAt: new Date() } }); // re-auth with the new role
  await AuditLog.create({ userId: u._id, actorRole: a.role, action: 'admin.role_changed', entity: 'user', entityId: u._id, requestId: req.id, meta: { by: a.userId, role: req.body.role } });
  res.json({ id: String(u._id), role: u.role });
}));

adminRouter.get('/audit', validate({ query: pageQuery.extend({ action: z.string().max(80).optional(), userId: objectId.optional() }) }), h(async (req, res) => {
  const q = req.query as any;
  const f: Record<string, unknown> = {};
  if (q.action) f.action = q.action;
  if (q.userId) f.userId = oid(q.userId);
  const rows: any[] = await AuditLog.find(f).sort({ createdAt: -1 }).limit(q.limit).lean();
  res.json({ items: rows.map((r) => ({ id: String(r._id), at: r.createdAt, action: r.action, userId: r.userId ? String(r.userId) : null, actorRole: r.actorRole, requestId: r.requestId ?? null })) });
}));

export const _p = Profile;
