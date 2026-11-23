import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id } });
};

/** Never leaks stack traces, query details or driver messages to clients. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
  }
  const type = (err as { type?: string })?.type;
  if (type === 'entity.too.large') return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId: req.id } });
  if (type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON', requestId: req.id } });

  // Log the error class and request id only; messages from drivers can embed document contents.
  // CastError metadata (field path, expected kind, model) is schema information, not user data, and is what makes these debuggable.
  const cast = (err as { name?: string }).name === 'CastError' ? { castPath: (err as any).path, castKind: (err as any).kind, castValueType: (err as any).valueType, castModel: (err as any).model?.modelName } : {};
  logger.error({ requestId: req.id, errName: (err as Error)?.name, path: req.path, method: req.method, ...cast }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
};
