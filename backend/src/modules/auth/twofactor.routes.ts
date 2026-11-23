import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { Session, User } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, unauthorized } from '../../shared/errors.js';
import { h } from '../../shared/http.js';
import { decryptField, encryptField, sha256Hex } from '../../utils/crypto.js';
import { keyRing } from './auth.service.js';
import { disable2faBody, totpCodeBody } from './auth.schemas.js';
import { verifyPassword } from './password.js';
import { generateSecret, otpauthUrl, verifyTotp } from './totp.js';

export const twoFactorRouter = Router();
twoFactorRouter.use(requireAuth, authLimiter());

/** Step 1: create a secret (stored encrypted, not yet active). */
twoFactorRouter.post('/setup', h(async (req, res) => {
  const { userId } = authed(req);
  const u: any = await User.findById(userId).select('email twoFactor.enabled');
  if (u.twoFactor?.enabled) throw badRequest('Two-factor authentication is already enabled');
  const secret = generateSecret();
  u.twoFactor = { enabled: false, secretEnvelope: encryptField(secret, keyRing(), `user:${userId}`) };
  await u.save();
  res.json({ secret, otpauthUrl: otpauthUrl(secret, u.email) });
}));

/** Step 2: prove possession with a code; returns one-time recovery codes (shown once, stored hashed). */
twoFactorRouter.post('/enable', validate({ body: totpCodeBody }), h(async (req, res) => {
  const { userId } = authed(req);
  const u: any = await User.findById(userId).select('twoFactor.enabled +twoFactor.secretEnvelope');
  if (!u.twoFactor?.secretEnvelope) throw badRequest('Start setup first');
  if (u.twoFactor.enabled) throw badRequest('Already enabled');
  const step = verifyTotp(decryptField(u.twoFactor.secretEnvelope, keyRing(), `user:${userId}`), req.body.code);
  if (step === null) throw badRequest('That code is not valid. Check your authenticator app and try again.');
  const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex')); // 10 hex chars
  u.twoFactor.enabled = true;
  u.twoFactor.lastStep = step;
  u.twoFactor.recoveryCodeHashes = codes.map((c: string) => sha256Hex(c));
  await u.save();
  res.json({ enabled: true, recoveryCodes: codes, note: 'Store these codes somewhere safe. Each works once and they will not be shown again.' });
}));

twoFactorRouter.post('/disable', validate({ body: disable2faBody }), h(async (req, res) => {
  const { userId, sessionId } = authed(req);
  const u: any = await User.findById(userId).select('+passwordHash +twoFactor.secretEnvelope twoFactor.enabled');
  if (!u.twoFactor?.enabled) throw badRequest('Two-factor authentication is not enabled');
  if (!(await verifyPassword(u.passwordHash, req.body.password))) throw unauthorized('Password is incorrect');
  if (verifyTotp(decryptField(u.twoFactor.secretEnvelope, keyRing(), `user:${userId}`), req.body.code) === null) throw unauthorized('Invalid authentication code');
  await User.updateOne({ _id: userId }, { $set: { 'twoFactor.enabled': false }, $unset: { 'twoFactor.secretEnvelope': 1, 'twoFactor.recoveryCodeHashes': 1, 'twoFactor.lastStep': 1 } });
  await Session.updateMany({ userId, revokedAt: null, _id: { $ne: sessionId } }, { $set: { revokedAt: new Date() } });
  res.json({ enabled: false });
}));
