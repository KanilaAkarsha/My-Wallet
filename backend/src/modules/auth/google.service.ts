import { env } from '../../config/env.js';
import { Profile, Session, User } from '../../database/models/index.js';
import { randomToken } from '../../utils/crypto.js';
import { audit, createSession, type ReqMeta } from './auth.service.js';
import { GOOGLE_TOKEN_URL, decodeJwtPayload, validateIdToken } from './google.js';
import { hashPassword } from './password.js';

export const googleConfigured = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => env().GOOGLE_REDIRECT_URI ?? `${env().APP_ORIGIN}/api/v1/auth/google/callback`;

export type GoogleFailure = 'failed' | 'two_factor' | 'suspended';
export class GoogleLoginError extends Error {
  constructor(public readonly reason: GoogleFailure) { super(reason); }
}

/** Exchanges the code (with the PKCE verifier) for tokens and returns validated identity claims. */
export async function exchangeCode(code: string, verifier: string, nonce: string) {
  const e = env();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: 'authorization_code', code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleLoginError('failed');
  const json = (await res.json()) as { id_token?: string };
  const claims = validateIdToken(decodeJwtPayload(json.id_token), { clientId: e.GOOGLE_CLIENT_ID!, nonce });
  if (!claims) throw new GoogleLoginError('failed');
  return claims;
}

/**
 * Finds, links or creates the user for a verified Google identity and starts a session.
 * - Existing Google link → sign in.
 * - Existing password account with the same (Google-verified) email → link it. If that account's email was never
 *   verified, its password is replaced and its sessions revoked, so someone who pre-registered the address cannot keep access.
 * - Accounts with 2FA enabled must sign in with password + authenticator code (Google sign-in is refused).
 */
export async function loginWithGoogle(claims: { sub: string; email: string; name?: string }, meta: ReqMeta) {
  let user: any = await User.findOne({ googleSub: claims.sub }).select('_id status twoFactor.enabled');
  if (!user) {
    user = await User.findOne({ email: claims.email }).select('_id status emailVerifiedAt twoFactor.enabled');
    if (user) {
      if (user.status !== 'active') throw new GoogleLoginError('suspended');
      if (user.twoFactor?.enabled) throw new GoogleLoginError('two_factor');
      const set: Record<string, unknown> = { googleSub: claims.sub };
      if (!user.emailVerifiedAt) {
        set.emailVerifiedAt = new Date();
        set.passwordHash = await hashPassword(randomToken(32));
        await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      }
      await User.updateOne({ _id: user._id }, { $set: set });
      await audit('auth.google_linked', user._id, meta, user._id);
    } else {
      user = await User.create({ email: claims.email, passwordHash: await hashPassword(randomToken(32)), googleSub: claims.sub, emailVerifiedAt: new Date() });
      await Profile.create({ userId: user._id, displayName: claims.name });
      await audit('auth.register_google', user._id, meta, user._id);
    }
  }
  if (user.status !== 'active') throw new GoogleLoginError('suspended');
  if (user.twoFactor?.enabled) throw new GoogleLoginError('two_factor');

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  const s = await createSession(user._id, meta);
  await Session.updateOne({ _id: s.sessionId }, { $set: { csrfPending: true } });
  await audit('auth.login_google', user._id, meta, s.sessionId);
  return s;
}
