import { Schema, model, type Types } from 'mongoose';
import { baseOptions, currencyField, ref, userRef } from './common.js';


export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  googleSub?: string;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  emailVerificationTokenHash?: string;
  emailVerificationExpiresAt?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;
  deletionRequestedAt?: Date | null;
  twoFactor?: { enabled: boolean; secretEnvelope?: string; lastStep?: number; recoveryCodeHashes?: string[] };
  createdAt: Date;
}
export interface ISession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  csrfHash: string;
  userAgent?: string;
  ipPrefix?: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  csrfPending?: boolean;
  lastSeenAt: Date;
  revokedAt: Date | null;
  rotatedFrom?: Types.ObjectId;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, unique: true },
    passwordHash: { type: String, required: true, select: false },
    /** Google account id (OIDC `sub`). Present only when the user signed in with Google. */
    googleSub: { type: String, unique: true, sparse: true, select: false },
    role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    emailVerifiedAt: { type: Date, default: null },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    twoFactor: {
      enabled: { type: Boolean, default: false },
      /** AES-256-GCM envelope: { keyId, iv, tag, ct } as a single string. Never plaintext. */
      secretEnvelope: { type: String, select: false },
      lastStep: { type: Number, select: false },
      recoveryCodeHashes: { type: [String], select: false, default: undefined },
    },
    deletionRequestedAt: { type: Date, default: null },
  },
  baseOptions,
);
userSchema.index({ status: 1, createdAt: -1 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const profileSchema = new Schema<any>(
  {
    userId: { ...userRef(), unique: true },
    displayName: { type: String, trim: true, maxlength: 80 },
    country: { type: String, uppercase: true, minlength: 2, maxlength: 2, default: 'LK' },
    currency: { ...currencyField(), required: false, default: 'LKR' },
    timezone: { type: String, default: 'Asia/Colombo' },
    /** Optional and never required; stored as a coarse band, not an exact figure. */
    incomeRange: { type: String, enum: ['<50k', '50k-100k', '100k-250k', '250k-500k', '500k+', null], default: null },
    occupation: { type: String, enum: ['student', 'employed', 'freelancer', 'other', null], default: null },
    modes: {
      student: { type: Boolean, default: false },
      youngProfessional: { type: Boolean, default: false },
    },
    goals: { type: [String], default: [] },
    /** Student / young-professional planning inputs. Integer minor units as strings; all optional. */
    planner: {
      monthlyAllowanceMinor: { type: String, default: null },
      weeklyLimitMinor: { type: String, default: null },
      semesterStart: { type: Date, default: null },
      semesterEnd: { type: Date, default: null },
      semesterBudgetMinor: { type: String, default: null },
      monthlySalaryMinor: { type: String, default: null },
      emergencyTargetMonths: { type: Number, min: 1, max: 24, default: 6 },
    },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    hideBalances: { type: Boolean, default: false },
    notificationPrefs: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      maskAmounts: { type: Boolean, default: true },
    },
    privacy: {
      aiExplanationsConsent: { type: Boolean, default: false },
      analyticsConsent: { type: Boolean, default: false },
    },
    onboardingCompletedAt: { type: Date, default: null },
  },
  baseOptions,
);

const sessionSchema = new Schema<ISession>(
  {
    userId: userRef(),
    /** SHA-256 of the opaque session id held in the HTTP-only cookie. The raw id is never stored. */
    tokenHash: { type: String, required: true, unique: true },
    csrfHash: { type: String, required: true },
    userAgent: { type: String, maxlength: 300 },
    ipPrefix: { type: String, maxlength: 64 }, // truncated, not the full IP
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    /** Set by OAuth sign-in: the browser may collect its CSRF token exactly once via GET /auth/csrf. */
    csrfPending: { type: Boolean, default: false },
    rotatedFrom: ref('Session'),
  },
  baseOptions,
);
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export const User = model('User', userSchema);
export const Profile: any = model('Profile', profileSchema);
export const Session = model('Session', sessionSchema);
