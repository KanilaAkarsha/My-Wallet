import type { RequestHandler } from 'express';
import { IdempotencyRecord } from '../database/models/index.js';
import { sha256Hex } from '../utils/crypto.js';
import { AppError, badRequest } from '../shared/errors.js';
import { jsonSafe } from '../shared/http.js';

/**
 * Idempotent POSTs. Same key + same payload => the original response is replayed; same key with
 * a different payload => 422; same key still running => 409. Keys are scoped per user.
 * Mount AFTER requireAuth. `required` makes the header mandatory (financial writes).
 */
export const idempotent =
  (opts: { required?: boolean; ttlHours?: number } = {}): RequestHandler =>
  async (req, res, next) => {
    try {
      const key = req.header('idempotency-key');
      if (!key) {
        if (opts.required) throw badRequest('Idempotency-Key header is required');
        return next();
      }
      if (!/^[\w.:-]{8,100}$/.test(key)) throw badRequest('Invalid Idempotency-Key');
      const userId = req.auth!.userId;
      const requestHash = sha256Hex(`${req.method}|${req.baseUrl}${req.path}|${JSON.stringify(req.body ?? {})}`);
      const expiresAt = new Date(Date.now() + (opts.ttlHours ?? 24) * 3600_000);

      try {
        await IdempotencyRecord.create({ userId, key, requestHash, expiresAt });
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const rec = await IdempotencyRecord.findOne({ userId, key }).lean();
        if (!rec) throw new AppError(409, 'IDEMPOTENCY_RETRY', 'Please retry');
        if (rec.requestHash !== requestHash) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Idempotency-Key was used with a different request');
        if (rec.status !== 'completed') throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Original request is still processing');
        res.setHeader('Idempotent-Replay', 'true');
        return void res.status(Number(rec.responseStatus ?? 200)).json(rec.responseBody ?? {});
      }

      const origJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        const safe = jsonSafe(body);
        const done =
          status >= 500
            ? IdempotencyRecord.deleteOne({ userId, key }) // allow retry after server errors
            : status >= 400
              ? IdempotencyRecord.deleteOne({ userId, key }) // client errors are not cached either
              : IdempotencyRecord.updateOne({ userId, key }, { $set: { status: 'completed', responseStatus: status, responseBody: safe } });
        void done.catch(() => undefined);
        return origJson(safe);
      };
      next();
    } catch (e) {
      next(e);
    }
  };
