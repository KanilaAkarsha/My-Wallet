import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { redis } from '../shared/cache.js';
import { RedisRateLimitStore } from './redisStore.js';
import { env } from '../config/env.js';
import { badRequest } from '../shared/errors.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export const securityHeaders = (): RequestHandler =>
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // JSON API: no content served
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: env().isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });

/** Strict CORS: one configured origin, credentials allowed, explicit methods/headers. */
export const strictCors = (): RequestHandler =>
  cors({
    origin: (origin, cb) => cb(null, !origin || origin === env().APP_ORIGIN),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });

const hasUnsafeKey = (v: unknown, depth = 0): boolean => {
  if (depth > 12) return true;
  if (Array.isArray(v)) return v.some((x) => hasUnsafeKey(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).some(
      ([k, val]) => k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || hasUnsafeKey(val, depth + 1),
    );
  }
  return false;
};

/** Rejects Mongo operator / prototype-pollution keys anywhere in body, query or params. */
export const rejectInjection: RequestHandler = (req, _res, next) => {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return next(badRequest('Request contains forbidden characters in field names'));
  }
  next();
};

export const requestTimeout =
  (): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    res.setTimeout(env().REQUEST_TIMEOUT_MS, () => {
      if (!res.headersSent) res.status(503).json({ error: { code: 'TIMEOUT', message: 'Request timed out', requestId: req.id } });
    });
    next();
  };

/** Shared Redis counters when REDIS_URL is set (limits hold across instances); otherwise per-process memory. */
const limiter = (windowMs: number, limit: number, code: string) =>
  rateLimit({
    windowMs,
    limit,
    store: new RedisRateLimitStore(redis, `rl:${code}:${windowMs}`),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: { code, message: 'Too many requests, please try again later', requestId: req.id } });
    },
  });

export const globalLimiter = () => limiter(60_000, 300, 'RATE_LIMITED');
export const authLimiter = () => limiter(15 * 60_000, 30, 'AUTH_RATE_LIMITED');
export const sensitiveLimiter = () => limiter(60 * 60_000, 10, 'RATE_LIMITED'); // email-sending endpoints
