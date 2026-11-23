import { env } from '../../config/env.js';
import { AuditLog, Profile, Session, User } from '../../database/models/index.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../shared/errors.js';
import { decryptField, keyRingFromHex } from '../../utils/crypto.js';
import { verifyTotp } from './totp.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { getMailer, type Mailer } from './mailer.js';
import { dummyHash, hashPassword, needsRehash, verifyPassword } from './password.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 30 * 60_000;
const day = 86_400_000;

export interface ReqMeta {
  userAgent?: string;
  ip?: string;
  requestId?: string;
}
const ipPrefix = (ip?: string) => (ip ? ip.replace(/(\d+\.\d+\.\d+)\.\d+$/, '$1.0').slice(0, 64) : undefined);

export async function audit(action: string, userId: unknown, meta: ReqMeta, entityId?: unknown) {
  await AuditLog.create({
    userId,
    action,
    entity: 'auth',
    entityId,
    requestId: meta.requestId,
    ipPrefix: ipPrefix(meta.ip),
    actorRole: 'user',
  }).catch(() => undefined); // auditing must not break auth flow; failures surface via monitoring
}

/** Creates a fresh session (rotation = revoke old + create new). Returns RAW tokens, shown once. */
export async function createSession(userId: unknown, meta: ReqMeta, rotatedFrom?: unknown) {
  const e = env();
  const sid = randomToken(32);
  const csrf = randomToken(32);
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + e.SESSION_ABSOLUTE_DAYS * day);
  const idle = new Date(now + e.SESSION_IDLE_DAYS * day);
  const doc = await Session.create({
    userId,
    tokenHash: sha256Hex(sid),
    csrfHash: sha256Hex(csrf),
    userAgent: meta.userAgent?.slice(0, 300),
    ipPrefix: ipPrefix(meta.ip),
    expiresAt: idle < absoluteExpiresAt ? idle : absoluteExpiresAt,
    absoluteExpiresAt,
    rotatedFrom,
  });
  return { sid, csrf, sessionId: String(doc._id), expiresAt: doc.expiresAt };
}

export async function register(
  input: { email: string; password: string; displayName?: string },
  meta: ReqMeta,
  mailer: Mailer = getMailer(),
): Promise<void> {
  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  // Identical outward behaviour whether or not the email exists (no account enumeration).
  if (existing) {
    await mailer.send({ to: input.email, subject: 'MyWallet sign-up attempt', text: 'An account already exists for this email.' });
    return;
  }
  const verifyToken = randomToken(32);
  const passwordHash = await hashPassword(input.password);
  const user = await User.create({
    email: input.email,
    passwordHash,
    emailVerificationTokenHash: sha256Hex(verifyToken),
    emailVerificationExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
  await Profile.create({ userId: user._id, displayName: input.displayName });
  await audit('auth.register', user._id, meta, user._id);
  const link = `${env().APP_ORIGIN}/verify-email?token=${verifyToken}`;
  await mailer.send({ to: input.email, subject: 'Verify your MyWallet email', text: `Verify: ${link}`, devLink: link });
}

export async function verifyEmail(token: string, meta: ReqMeta): Promise<void> {
  const user = await User.findOne({
    emailVerificationTokenHash: sha256Hex(token),
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select('_id');
  if (!user) throw badRequest('Invalid or expired verification link');
  await User.updateOne(
    { _id: user._id },
    { $set: { emailVerifiedAt: new Date() }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } },
  );
  await audit('auth.email_verified', user._id, meta, user._id);
}

export const keyRing = () => keyRingFromHex(env().FIELD_ENCRYPTION_KEY_ID, env().FIELD_ENCRYPTION_KEY);

export async function login(input: { email: string; password: string; totp?: string; recoveryCode?: string }, meta: ReqMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash +twoFactor.secretEnvelope +twoFactor.lastStep +twoFactor.recoveryCodeHashes');
  if (!user || user.status !== 'active') {
    await verifyPassword(await dummyHash(), input.password); // equalise timing
    throw unauthorized('Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Same message as bad credentials: do not confirm the account exists or reveal lock state precisely.
    throw unauthorized('Invalid email or password');
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await User.updateOne(
      { _id: user._id },
      failed >= MAX_FAILED
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } }
        : { $set: { failedLoginCount: failed } },
    );
    await audit(failed >= MAX_FAILED ? 'auth.locked' : 'auth.login_failed', user._id, meta, user._id);
    throw unauthorized('Invalid email or password');
  }
  if (env().requireEmailVerification && !user.emailVerifiedAt) throw forbidden('Please verify your email address first');

  const second: Record<string, unknown> = {};
  if (user.twoFactor?.enabled) {
    if (!input.totp && !input.recoveryCode) throw new AppError(401, 'TOTP_REQUIRED', 'Enter your authentication code');
    let okSecond = false;
    if (input.totp) {
      const step = verifyTotp(decryptField(user.twoFactor.secretEnvelope!, keyRing(), `user:${user._id}`), input.totp);
      // Replay protection: a code (step) can be used once.
      if (step !== null && step > (user.twoFactor.lastStep ?? -1)) { okSecond = true; second['twoFactor.lastStep'] = step; }
    } else if (input.recoveryCode) {
      const h = sha256Hex(input.recoveryCode.trim().toLowerCase());
      if ((user.twoFactor.recoveryCodeHashes ?? []).includes(h)) {
        okSecond = true;
        await User.updateOne({ _id: user._id }, { $pull: { 'twoFactor.recoveryCodeHashes': h } }); // single use
      }
    }
    if (!okSecond) {
      const failed = user.failedLoginCount + 1;
      await User.updateOne({ _id: user._id }, failed >= MAX_FAILED ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } } : { $set: { failedLoginCount: failed } });
      await audit('auth.2fa_failed', user._id, meta, user._id);
      throw unauthorized('Invalid authentication code');
    }
  }

  const update: Record<string, unknown> = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), ...second };
  if (needsRehash(user.passwordHash)) update.passwordHash = await hashPassword(input.password);
  await User.updateOne({ _id: user._id }, { $set: update });

  const s = await createSession(user._id, meta);
  await audit('auth.login', user._id, meta, s.sessionId);
  return { userId: String(user._id), ...s };
}

export async function logout(sessionId: string, userId: string, meta: ReqMeta): Promise<void> {
  await Session.updateOne({ _id: sessionId, userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit('auth.logout', userId, meta, sessionId);
}

/** Always resolves identically so callers cannot probe which emails exist. */
export async function forgotPassword(email: string, meta: ReqMeta, mailer: Mailer = getMailer()): Promise<void> {
  const user = await User.findOne({ email, status: 'active' }).select('_id');
  if (!user) return;
  const token = randomToken(32);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordResetTokenHash: sha256Hex(token), passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS) } },
  );
  const link = `${env().APP_ORIGIN}/reset-password?token=${token}`;
  await mailer.send({ to: email, subject: 'Reset your MyWallet password', text: `Reset: ${link}`, devLink: link });
  await audit('auth.reset_requested', user._id, meta, user._id);
}

export async function resetPassword(token: string, newPassword: string, meta: ReqMeta): Promise<void> {
  const user = await User.findOne({ passwordResetTokenHash: sha256Hex(token), passwordResetExpiresAt: { $gt: new Date() } }).select('_id');
  if (!user) throw badRequest('Invalid or expired reset link');
  // Single use + revoke every session: a reset implies the old credentials may be compromised.
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    },
  );
  await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit('auth.password_reset', user._id, meta, user._id);
}

export async function changePassword(userId: string, sessionId: string, current: string, next: string, meta: ReqMeta) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await verifyPassword(user.passwordHash, current))) throw unauthorized('Current password is incorrect');
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(next) } });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  const s = await createSession(userId, meta, sessionId); // rotation on privilege change
  await audit('auth.password_changed', userId, meta, s.sessionId);
  return s;
}

export async function listSessions(userId: string, currentSessionId: string) {
  const now = new Date();
  const rows = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: now } })
    .select('userAgent ipPrefix createdAt lastSeenAt')
    .sort({ lastSeenAt: -1 })
    .lean();
  return rows.map((s) => ({
    id: String(s._id),
    userAgent: s.userAgent,
    ipPrefix: s.ipPrefix,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: String(s._id) === currentSessionId,
  }));
}

export async function revokeSession(userId: string, sessionId: string, meta: ReqMeta): Promise<boolean> {
  const r = await Session.updateOne({ _id: sessionId, userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (r.modifiedCount) await audit('auth.session_revoked', userId, meta, sessionId);
  return r.modifiedCount > 0;
}

export async function revokeOtherSessions(userId: string, keepSessionId: string, meta: ReqMeta): Promise<number> {
  const r = await Session.updateMany({ userId, revokedAt: null, _id: { $ne: keepSessionId } }, { $set: { revokedAt: new Date() } });
  await audit('auth.sessions_revoked_all', userId, meta);
  return r.modifiedCount;
}
