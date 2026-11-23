import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { Session, User } from '../database/models/index.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { safeEqualHex, sha256Hex } from '../utils/crypto.js';

export const SESSION_COOKIE = 'mw_sid';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: 'user' | 'admin' | 'superadmin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthContext;
    }
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOUCH_INTERVAL_MS = 5 * 60_000;

/**
 * Resolves the session from the HTTP-only cookie. The authenticated identity is the ONLY source of
 * userId for the rest of the request; it is never read from body, query or params.
 * State-changing requests additionally need the session-bound CSRF token.
 */
export const requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) throw unauthorized();

    const now = new Date();
    const session = await Session.findOne({
      tokenHash: sha256Hex(raw),
      revokedAt: null,
      expiresAt: { $gt: now },
      absoluteExpiresAt: { $gt: now },
    }).lean();
    if (!session) throw unauthorized('Session expired or revoked');

    if (!SAFE.has(req.method)) {
      const csrf = req.header('x-csrf-token');
      if (!csrf || !safeEqualHex(sha256Hex(csrf), session.csrfHash)) throw forbidden('Invalid CSRF token');
    }

    const user = await User.findById(session.userId).select('role status emailVerifiedAt').lean();
    if (!user || user.status !== 'active') throw unauthorized('Account unavailable');
    if (env().requireEmailVerification && !user.emailVerifiedAt) throw forbidden('Email address not verified');

    if (now.getTime() - new Date(session.lastSeenAt ?? 0).getTime() > TOUCH_INTERVAL_MS) {
      const idle = new Date(now.getTime() + env().SESSION_IDLE_DAYS * 86_400_000);
      const expiresAt = idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt;
      await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: now, expiresAt } });
    }

    req.auth = { userId: String(session.userId), sessionId: String(session._id), role: user.role as AuthContext['role'] };
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole =
  (...roles: AuthContext['role'][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

/** Typed accessor so handlers cannot forget authentication. */
export function authed(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
