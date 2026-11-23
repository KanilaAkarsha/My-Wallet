import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { h, idParams, pageQuery, decodeCursor, encodeCursor } from '../../shared/http.js';
import { oid } from '../../database/models/common.js';
import { findOwned } from '../../shared/ownership.js';
import { scanNotifications } from './notifications.service.js';

const dto = (n: any) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, read: !!n.readAt, createdAt: n.createdAt });

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', validate({ query: pageQuery.extend({ unread: z.enum(['true', 'false']).optional() }) }), h(async (req, res) => {
  const { userId } = authed(req);
  const q = req.query as any;
  const cur = decodeCursor(q.cursor);
  const f: Record<string, unknown> = { userId: oid(userId) };
  if (q.unread === 'true') f.readAt = null;
  if (cur) f.$or = [{ createdAt: { $lt: cur.d } }, { createdAt: cur.d, _id: { $lt: oid(cur.i) } }];
  const rows: any[] = await Notification.find(f).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean();
  const more = rows.length > q.limit;
  const page = more ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  res.json({ items: page.map(dto), unreadCount: await Notification.countDocuments({ userId, readAt: null }), nextCursor: more && last ? encodeCursor(last.createdAt, last._id) : null });
}));

notificationsRouter.post('/read-all', h(async (req, res) => {
  const { userId } = authed(req);
  await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
}));

notificationsRouter.post('/:id/read', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const n = await findOwned(Notification, userId, req.params.id, 'Notification');
  n.readAt = n.readAt ?? new Date();
  await n.save();
  res.json(dto(n));
}));

/** Manual trigger of the same idempotent scan the scheduled job runs. */
notificationsRouter.post('/scan', h(async (req, res) => {
  res.json({ created: await scanNotifications(authed(req).userId) });
}));
