import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from './provider.js';

const secret = 'whsec_test';
const body = Buffer.from('{"id":"evt_1","type":"invoice.paid"}');
const sign = (t: number, b = body, s = secret) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.`).update(b).digest('hex')}`;

describe('webhook signature verification', () => {
  const now = 1_800_000_000;
  it('accepts a correct, fresh signature', () => expect(verifyStripeSignature(body, sign(now), secret, 300, now)).toBe(true));
  it('rejects tampered bodies, wrong secrets, stale timestamps and missing headers', () => {
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), sign(now), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(now, body, 'other'), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(now - 1000), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, 't=abc,v1=00', secret, 300, now)).toBe(false);
  });
  it('accepts when any of several v1 signatures matches (key rotation)', () => {
    const good = sign(now).split(',v1=')[1]!;
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,v1=${good}`, secret, 300, now)).toBe(true);
  });
});
