/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, model } from 'mongoose';
import { baseOptions, currencyField, minorField, ref, userRef } from './common.js';

const attachmentSchema = new Schema<any>(
  {
    userId: userRef(),
    kind: { type: String, enum: ['receipt', 'goal_image'], required: true },
    originalName: { type: String, maxlength: 200 },
    mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], required: true },
    sizeBytes: { type: Number, required: true, max: 5 * 1024 * 1024 },
    sha256: { type: String, required: true },
    /** Opaque storage key; files are served only through an ownership-checked endpoint. */
    storageKey: { type: String, required: true, select: false },
    transactionId: ref('Transaction'),
    deletedAt: { type: Date, default: null },
  },
  baseOptions,
);
attachmentSchema.index({ userId: 1, transactionId: 1 });

/** Append-only. Contains ids and action names, never amounts, descriptions or secrets. */
const auditLogSchema = new Schema<any>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String, enum: ['user', 'admin', 'superadmin', 'system'], default: 'user' },
    action: { type: String, required: true, maxlength: 80 },
    entity: { type: String, maxlength: 40 },
    entityId: { type: Schema.Types.ObjectId },
    requestId: { type: String, maxlength: 64 },
    ipPrefix: { type: String, maxlength: 64 },
    meta: { type: Schema.Types.Mixed },
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const subscriptionPlanSchema = new Schema<any>(
  {
    code: { type: String, required: true, unique: true, enum: ['free', 'plus', 'premium'] },
    name: { type: String, required: true },
    priceMinor: minorField({ min: 0n }),
    currency: currencyField(),
    interval: { type: String, enum: ['month', 'year'], default: 'month' },
    trialDays: { type: Number, default: 0, min: 0 },
    providerPriceId: { type: String }, // set only when a payment provider is configured
    limits: {
      accounts: { type: Number, default: 3 },
      budgets: { type: Number, default: 3 },
      savingsGoals: { type: Number, default: 0 },
      recurring: { type: Number, default: 0 },
      reportMonths: { type: Number, default: 3 }, // visible report window only; history is never deleted
    },
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  baseOptions,
);

/** Server-side idempotency: (userId, key) maps to the stored response of the first request. */
const idempotencyRecordSchema = new Schema<any>(
  {
    userId: userRef(),
    key: { type: String, required: true, maxlength: 100 },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
    responseStatus: Number,
    responseBody: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  baseOptions,
);
idempotencyRecordSchema.index({ userId: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const billingSubscriptionSchema = new Schema<any>(
  {
    userId: { ...userRef(), unique: true },
    planCode: { type: String, enum: ['free', 'plus', 'premium'], default: 'free' },
    status: { type: String, enum: ['active', 'trialing', 'past_due', 'cancelled', 'expired'], default: 'active' },
    trialEndsAt: Date,
    trialUsed: { type: Boolean, default: false },
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: { type: Boolean, default: false },
    pendingPlanCode: { type: String, enum: ['free', 'plus', 'premium', null], default: null }, // scheduled downgrade
    provider: String,
    providerCustomerId: String,
    providerSubscriptionId: String,
  },
  baseOptions,
);

const paymentSchema = new Schema<any>(
  {
    userId: userRef(),
    planCode: String,
    amountMinor: minorField({ min: 0n }),
    currency: currencyField(),
    status: { type: String, enum: ['succeeded', 'failed', 'refunded'], required: true },
    provider: { type: String, required: true },
    providerPaymentId: { type: String, required: true },
    paidAt: Date,
  },
  baseOptions,
);
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true });

export const BillingSubscription: any = model('BillingSubscription', billingSubscriptionSchema);
export const Payment: any = model('Payment', paymentSchema);
export const Attachment: any = model('Attachment', attachmentSchema);
export const AuditLog: any = model('AuditLog', auditLogSchema);
export const SubscriptionPlan: any = model('SubscriptionPlan', subscriptionPlanSchema);
export const IdempotencyRecord: any = model('IdempotencyRecord', idempotencyRecordSchema);
