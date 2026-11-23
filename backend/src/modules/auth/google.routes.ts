import { Router, type Request } from 'express';
import { env } from '../../config/env.js';
import { Session } from '../../database/models/index.js';
import { SESSION_COOKIE, authed, requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/security.js';
import { AppError, forbidden } from '../../shared/errors.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { OAUTH_COOKIE, OAUTH_TTL_MS, buildAuthUrl, newOAuthState, signState, verifyState } from './google.js';
import { GoogleLoginError, exchangeCode, googleConfigured, googleRedirectUri, loginWithGoogle } from './google.service.js';
import type { ReqMeta } from './auth.service.js';

const meta = (req: Request): ReqMeta => ({ userAgent: req.header('user-agent'), ip: req.ip, requestId: String(req.id) });
const oauthCookie = () => ({ httpOnly: true, secure: env().isProd, sameSite: 'lax' as const, path: '/api/v1/auth/google', maxAge: OAUTH_TTL_MS });
const fail = (reason: string) => `${env().APP_ORIGIN}/login?error=google_${reason}`;

export const googleRouter = Router();

/** Public: lets the SPA decide whether to show the "Continue with Google" button. */
googleRouter.get('/providers', (_req, res) => void res.json({ google: googleConfigured() }));

googleRouter.get('/google', authLimiter(), (req, res, next) => {
  try {
    if (!googleConfigured()) throw new AppError(501, 'NOT_CONFIGURED', 'Google sign-in is not configured');
    const st = newOAuthState();
    res.cookie(OAUTH_COOKIE, signState(st, env().SESSION_SECRET), oauthCookie());
    res.redirect(buildAuthUrl({ clientId: env().GOOGLE_CLIENT_ID!, redirectUri: googleRedirectUri(), state: st.state, nonce: st.nonce, verifier: st.verifier }));
  } catch (e) {
    next(e);
  }
});

googleRouter.get('/google/callback', authLimiter(), async (req, res) => {
  const clear = () => res.clearCookie(OAUTH_COOKIE, { ...oauthCookie(), maxAge: undefined });
  try {
    if (!googleConfigured()) return void res.redirect(fail('not_configured'));
    const saved = verifyState(req.cookies?.[OAUTH_COOKIE], env().SESSION_SECRET);
    clear();
    const { code, state, error } = req.query as Record<string, unknown>;
    if (error === 'access_denied') return void res.redirect(fail('cancelled'));
    if (!saved || typeof state !== 'string' || state !== saved.state || typeof code !== 'string' || code.length > 2048) return void res.redirect(fail('failed'));

    const claims = await exchangeCode(code, saved.verifier, saved.nonce);
    const s = await loginWithGoogle(claims, meta(req));
    res.cookie(SESSION_COOKIE, s.sid, { httpOnly: true, secure: env().isProd || env().COOKIE_SAMESITE === 'none', sameSite: env().COOKIE_SAMESITE, domain: env().COOKIE_DOMAIN, path: '/', expires: s.expiresAt });
    res.redirect(`${env().APP_ORIGIN}/auth/google/done`);
  } catch (e) {
    clear();
    res.redirect(fail(e instanceof GoogleLoginError ? e.reason : 'failed'));
  }
});

/**
 * One-time CSRF token hand-off after an OAuth redirect (password login returns it in the JSON body instead).
 * Works only while the session is flagged csrfPending, and clears the flag, so it cannot be used to re-roll tokens later.
 */
googleRouter.get('/csrf', requireAuth, async (req, res, next) => {
  try {
    const csrf = randomToken(32);
    const r = await Session.updateOne({ _id: authed(req).sessionId, csrfPending: true }, { $set: { csrfHash: sha256Hex(csrf), csrfPending: false } });
    if (r.modifiedCount !== 1) throw forbidden('CSRF token already issued');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: csrf });
  } catch (e) {
    next(e);
  }
});
