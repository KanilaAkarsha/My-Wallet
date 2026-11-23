import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { Attachment, Transaction } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest } from '../../shared/errors.js';
import { h, idParams } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { env } from '../../config/env.js';

const MAX = 5 * 1024 * 1024;

/** Content sniffing: the declared Content-Type is never trusted. */
export function sniff(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 5 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'));

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

/** Raw-body upload (no multipart parser = smaller attack surface). Query: kind=receipt|goal_image, transactionId?, name? */
attachmentsRouter.post('/', express.raw({ type: () => true, limit: MAX }), h(async (req, res) => {
  const { userId } = authed(req);
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('Empty upload');
  const mime = sniff(buf);
  if (!mime) throw badRequest('Only JPEG, PNG, WebP images and PDF files are allowed');
  const kind = req.query.kind === 'goal_image' ? 'goal_image' : 'receipt';
  let transactionId: string | undefined;
  if (typeof req.query.transactionId === 'string') {
    transactionId = String((await findOwned(Transaction, userId, req.query.transactionId, 'Transaction', { deletedAt: null }))._id);
  }
  const key = `${userId}/${randomBytes(16).toString('hex')}.${EXT[mime]}`; // server-generated; user input never touches the path
  const full = path.join(uploadDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { mode: 0o600 });
  const name = typeof req.query.name === 'string' ? req.query.name.replace(/[^\w.\- ]/g, '_').slice(0, 100) : undefined;
  const a = await Attachment.create({ userId, kind, originalName: name, mimeType: mime, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storageKey: key, transactionId });
  if (transactionId) await Transaction.updateOne({ _id: transactionId, userId }, { $addToSet: { attachmentIds: a._id } });
  res.status(201).json({ id: String(a._id), mimeType: mime, sizeBytes: buf.length, kind });
}));

/** Ownership-checked download. Never served statically. */
attachmentsRouter.get('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const a: any = await Attachment.findOne({ _id: req.params.id, userId, deletedAt: null }).select('+storageKey');
  if (!a) throw badRequest('Not found'); // generic
  const full = path.join(uploadDir(), a.storageKey);
  if (!full.startsWith(uploadDir() + path.sep)) throw badRequest('Not found');
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${a.originalName ?? `file.${EXT[a.mimeType as keyof typeof EXT]}`}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(await fs.readFile(full));
}));

attachmentsRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const a = await findOwned(Attachment, userId, req.params.id, 'Attachment', { deletedAt: null });
  a.deletedAt = new Date();
  await a.save();
  await Transaction.updateMany({ userId, attachmentIds: a._id }, { $pull: { attachmentIds: a._id } });
  res.status(204).end();
}));

export const _env = env;
