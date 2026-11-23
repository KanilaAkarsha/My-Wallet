import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');

/** 256-bit random, URL-safe. Used for session ids, CSRF tokens, email/reset tokens. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

/**
 * Application-level field encryption (AES-256-GCM) for secrets such as 2FA seeds.
 * Envelope format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * Key management: keys come from the environment/secret manager, never the database.
 * Rotation: add the new key under a new id and keep old ids available for decryption only.
 */
export type KeyRing = { activeId: string; keys: Record<string, Buffer> };

export const keyRingFromHex = (activeId: string, hex: string): KeyRing => {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('Field encryption key must be 32 bytes');
  return { activeId, keys: { [activeId]: key } };
};

export function encryptField(plaintext: string, ring: KeyRing, aad = ''): string {
  const key = ring.keys[ring.activeId];
  if (!key) throw new Error('Active encryption key missing');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', ring.activeId, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptField(envelope: string, ring: KeyRing, aad = ''): string {
  const [v, keyId, iv, tag, ct] = envelope.split('.');
  if (v !== 'v1' || !keyId || !iv || !tag || !ct) throw new Error('Malformed encrypted field');
  const key = ring.keys[keyId];
  if (!key) throw new Error(`Unknown encryption key id: ${keyId}`);
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
