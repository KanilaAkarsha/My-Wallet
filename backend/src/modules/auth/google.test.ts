import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAuthUrl, decodeJwtPayload, newOAuthState, pkceChallenge, signState, validateIdToken, verifyState } from './google.js';

const SECRET = 'a'.repeat(64);
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const good = (o: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n1', sub: '123', email: 'A@B.co', email_verified: true, name: 'Ann', ...o });

describe('OAuth state cookie', () => {
  it('round-trips and rejects tampering, wrong secret and expiry', () => {
    const st = newOAuthState();
    const c = signState(st, SECRET);
    expect(verifyState(c, SECRET)).toEqual(st);
    expect(verifyState(c, 'b'.repeat(64))).toBeNull();
    expect(verifyState(c.replace(/^./, (x) => (x === 'A' ? 'B' : 'A')), SECRET)).toBeNull();
    expect(verifyState(c, SECRET, st.exp + 1)).toBeNull();
    expect(verifyState(undefined, SECRET)).toBeNull();
    expect(verifyState('x'.repeat(3000), SECRET)).toBeNull();
    expect(verifyState('nodot', SECRET)).toBeNull();
  });
  it('generates unguessable distinct values', () => {
    const a = newOAuthState(); const b = newOAuthState();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe('authorization URL', () => {
  it('uses code flow with PKCE S256, state, nonce and the right scopes', () => {
    const st = newOAuthState();
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:5173/api/v1/auth/google/callback', state: st.state, nonce: st.nonce, verifier: st.verifier }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(st.verifier).digest('base64url'));
    expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge(st.verifier));
    expect(u.searchParams.get('state')).toBe(st.state);
    expect(u.searchParams.get('nonce')).toBe(st.nonce);
    expect(u.search).not.toContain(st.verifier); // the verifier itself is never sent in the URL
  });
});

describe('ID token validation', () => {
  const o = { clientId: 'cid', nonce: 'n1' };
  it('accepts a valid token and lowercases the email', () => {
    expect(validateIdToken(decodeJwtPayload(jwt(good())), o)).toEqual({ sub: '123', email: 'a@b.co', name: 'Ann' });
    expect(validateIdToken(decodeJwtPayload(jwt(good({ iss: 'accounts.google.com' }))), o)).not.toBeNull();
  });
  it.each([
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong audience', { aud: 'other' }],
    ['expired', { exp: 1 }],
    ['wrong nonce', { nonce: 'nope' }],
    ['missing sub', { sub: '' }],
    ['unverified email', { email_verified: false }],
    ['email_verified as string', { email_verified: 'true' }],
    ['no email', { email: undefined }],
    ['malformed email', { email: 'nope' }],
  ])('rejects %s', (_n, patch) => {
    expect(validateIdToken(decodeJwtPayload(jwt(good(patch))), o)).toBeNull();
  });
  it('rejects non-JWT input', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(validateIdToken(null, o)).toBeNull();
  });
});
