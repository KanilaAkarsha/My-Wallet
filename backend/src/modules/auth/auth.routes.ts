import { Router, type CookieOptions, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { SESSION_COOKIE, authed, requireAuth } from '../../middleware/auth.js';
import { authLimiter, sensitiveLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { User } from '../../database/models/index.js';
import { notFound } from '../../shared/errors.js';
import * as svc from './auth.service.js';
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
  verifyEmailBody,
} from './auth.schemas.js';

const meta = (req: Request): svc.ReqMeta => ({ userAgent: req.header('user-agent'), ip: req.ip, requestId: String(req.id) });

function cookieOptions(expires?: Date): CookieOptions {
  const e = env();
  return {
    httpOnly: true,
    secure: e.isProd || e.COOKIE_SAMESITE === 'none',
    sameSite: e.COOKIE_SAMESITE,
    domain: e.COOKIE_DOMAIN,
    path: '/',
    expires,
  };
}
const setSession = (res: Response, sid: string, expires: Date) => res.cookie(SESSION_COOKIE, sid, cookieOptions(expires));

export const authRouter = Router();

authRouter.post('/register', sensitiveLimiter(), validate({ body: registerBody }), async (req, res, next) => {
  try {
    await svc.register(req.body, meta(req));
    // Same response whether or not the address was already registered.
    res.status(202).json({ message: 'If this email can be registered, a verification message has been sent.' });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/verify-email', authLimiter(), validate({ body: verifyEmailBody }), async (req, res, next) => {
  try {
    await svc.verifyEmail(req.body.token, meta(req));
    res.json({ message: 'Email verified' });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', authLimiter(), validate({ body: loginBody }), async (req, res, next) => {
  try {
    const s = await svc.login(req.body, meta(req));
    setSession(res, s.sid, s.expiresAt);
    // The CSRF token is returned in the body (kept in memory by the SPA), never in a cookie or localStorage.
    res.json({ csrfToken: s.csrf });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const a = authed(req);
    await svc.logout(a.sessionId, a.userId, meta(req));
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.post('/forgot-password', sensitiveLimiter(), validate({ body: forgotPasswordBody }), async (req, res, next) => {
  try {
    await svc.forgotPassword(req.body.email, meta(req));
    res.status(202).json({ message: 'If an account exists for this email, a reset link has been sent.' });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/reset-password', authLimiter(), validate({ body: resetPasswordBody }), async (req, res, next) => {
  try {
    await svc.resetPassword(req.body.token, req.body.newPassword, meta(req));
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.json({ message: 'Password updated. Please sign in again.' });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(authed(req).userId).select('email role emailVerifiedAt twoFactor.enabled createdAt').lean();
    if (!user) throw notFound('User');
    res.json({ id: String(user._id), email: user.email, role: user.role, emailVerified: !!user.emailVerifiedAt, twoFactorEnabled: !!user.twoFactor?.enabled });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/change-password', requireAuth, authLimiter(), validate({ body: changePasswordBody }), async (req, res, next) => {
  try {
    const a = authed(req);
    const s = await svc.changePassword(a.userId, a.sessionId, req.body.currentPassword, req.body.newPassword, meta(req));
    setSession(res, s.sid, s.expiresAt);
    res.json({ csrfToken: s.csrf });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const a = authed(req);
    res.json({ sessions: await svc.listSessions(a.userId, a.sessionId) });
  } catch (e) {
    next(e);
  }
});

authRouter.delete('/sessions/:id', requireAuth, validate({ params: sessionIdParams }), async (req, res, next) => {
  try {
    const ok = await svc.revokeSession(authed(req).userId, String(req.params.id), meta(req));
    if (!ok) throw notFound('Session');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.post('/sessions/revoke-others', requireAuth, async (req, res, next) => {
  try {
    const a = authed(req);
    res.json({ revoked: await svc.revokeOtherSessions(a.userId, a.sessionId, meta(req)) });
  } catch (e) {
    next(e);
  }
});
