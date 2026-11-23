import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateSecret, hotp, verifyTotp } from './totp.js';

describe('TOTP', () => {
  const rfcSecret = Buffer.from('12345678901234567890');
  it('matches RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(rfcSecret, c))).toEqual(['755224', '287082', '359152', '969429', '520489']);
  });
  it('matches RFC 6238 vector (t=59 -> last 6 digits of 94287082)', () => {
    expect(hotp(rfcSecret, Math.floor(59 / 30))).toBe('287082');
  });
  it('base32 round-trips', () => {
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(rfcSecret)).toBe(true);
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('verifies within ±1 step only, rejects malformed codes', () => {
    const secret = base32Encode(rfcSecret);
    const t = 59_000;
    expect(verifyTotp(secret, '287082', t)).toBe(1);
    expect(verifyTotp(secret, '287082', t + 30_000)).toBe(1); // previous step still accepted
    expect(verifyTotp(secret, '287082', t + 90_000)).toBeNull();
    expect(verifyTotp(secret, '12345', t)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', t)).toBeNull();
  });
});
