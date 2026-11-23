import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Pure helpers for the Google OpenID Connect authorization-code flow (with PKCE). No I/O here so they can be unit-tested. */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_COOKIE = 'mw_oauth';
export const OAUTH_TTL_MS = 10 * 60_000;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface OAuthState { state: string; nonce: string; verifier: string; exp: number }

export function newOAuthState(now = Date.now()): OAuthState {
  return { state: b64u(randomBytes(24)), nonce: b64u(randomBytes(24)), verifier: b64u(randomBytes(48)), exp: now + OAUTH_TTL_MS };
}

export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Tamper-evident cookie value: base64url(json) + "." + HMAC. The cookie is also HTTP-only, so scripts never see the verifier. */
export function signState(s: OAuthState, secret: string): string {
  const body = b64u(JSON.stringify(s));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyState(cookie: unknown, secret: string, now = Date.now()): OAuthState | null {
  if (typeof cookie !== 'string' || cookie.length > 2000) return null;
  const [body, mac] = cookie.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    if (typeof s.state !== 'string' || typeof s.nonce !== 'string' || typeof s.verifier !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string; nonce: string; verifier: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: o.state,
    nonce: o.nonce,
    code_challenge: pkceChallenge(o.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

export interface GoogleClaims { sub: string; email: string; name?: string }

export function decodeJwtPayload(jwt: unknown): Record<string, unknown> | null {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Validates the ID-token claims. The token is received directly from Google's token endpoint over TLS (back channel),
 * which per OpenID Connect Core §3.1.3.7 lets the client skip signature verification; every other check still applies.
 */
export function validateIdToken(claims: Record<string, unknown> | null, o: { clientId: string; nonce: string; now?: number }): GoogleClaims | null {
  if (!claims) return null;
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return null;
  if (claims.aud !== o.clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (claims.nonce !== o.nonce) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
  if (claims.email_verified !== true) return null; // never trust an unverified address
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name.slice(0, 80) : undefined };
}
