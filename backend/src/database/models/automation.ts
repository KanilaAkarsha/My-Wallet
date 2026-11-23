/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, model } from 'mongoose';
import { baseOptions, currencyField, minorField, ref, softDelete, userRef } from './common.js';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'] as const;

const recurrence = {
  frequency: { type: String, enum: FREQUENCIES, required: true },
  /** For `custom`: every N days. */
  intervalDays: { type: Number, min: 1, max: 3660 },
  startDate: { type: Date, required: true },
  endDate: Date,
  timezone: { type: String, default: 'Asia/Colombo' },
};

const billSchema = new Schema<any>(
  {
    userId: userRef(),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, enum: ['electricity', 'water', 'internet', 'phone', 'rent', 'tuition', 'installment', 'other'], default: 'other' },
    expectedAmountMinor: minorField({ min: 1n }),
    currency: currencyField(),
    categoryId: ref('Category'),
    accountId: ref('Account'),
    recurrence,
    nextDueDate: { type: Date, required: true },
    reminderDaysBefore: { type: [Number], default: [3, 1] },
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active' },
    ...softDelete,
  },
  baseOptions,
);
billSchema.index({ userId: 1, status: 1, nextDueDate: 1 });

const recurringTransactionSchema = new Schema<any>(
  {
    userId: userRef(),
    title: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amountMinor: minorField({ min: 1n }),
    currency: currencyField(),
    accountId: ref('Account', true),
    categoryId: ref('Category'),
    billId: ref('Bill'),
    subscriptionId: ref('Subscription'),
    recurrence,
    autoPost: { type: Boolean, default: false }, // false = creates pending, user confirms
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active' },
    lastGeneratedThrough: Date,
    ...softDelete,
  },
  baseOptions,
);
recurringTransactionSchema.index({ userId: 1, status: 1 });

/** One document per (schedule, occurrence). The unique index is what makes generation idempotent. */
const recurringOccurrenceSchema = new Schema<any>(
  {
    userId: userRef(),
    scheduleId: { ...ref('RecurringTransaction', true), immutable: true },
    occurrenceDate: { type: Date, required: true, immutable: true },
    transactionId: ref('Transaction'),
    status: { type: String, enum: ['generated', 'skipped', 'failed'], default: 'generated' },
    error: { type: String, maxlength: 300 },
  },
  baseOptions,
);
recurringOccurrenceSchema.index({ userId: 1, scheduleId: 1, occurrenceDate: 1 }, { unique: true });

const subscriptionSchema = new Schema<any>(
  {
    userId: userRef(),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    provider: { type: String, maxlength: 80 },
    kind: { type: String, enum: ['streaming', 'software', 'cloud', 'mobile', 'membership', 'other'], default: 'other' },
    amountMinor: minorField({ min: 1n }),
    currency: currencyField(),
    billingFrequency: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'yearly'], required: true },
    nextBillingDate: { type: Date, required: true },
    paymentAccountId: ref('Account'),
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelledAt: Date, // user-recorded; MyWallet cannot cancel external subscriptions
    ...softDelete,
  },
  baseOptions,
);
subscriptionSchema.index({ userId: 1, status: 1, nextBillingDate: 1 });

const notificationSchema = new Schema<any>(
  {
    userId: userRef(),
    type: {
      type: String,
      enum: ['bill_due', 'budget_alert', 'savings_milestone', 'recurring_reminder', 'subscription_renewal', 'debt_due', 'monthly_summary', 'system'],
      required: true,
    },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, maxlength: 400 }, // never contains amounts when profile.notificationPrefs.maskAmounts
    link: { type: String, maxlength: 200 },
    dedupeKey: { type: String, maxlength: 160 },
    readAt: { type: Date, default: null },
    emailedAt: Date,
  },
  baseOptions,
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

const financialInsightSchema = new Schema<any>(
  {
    userId: userRef(),
    ruleId: { type: String, required: true },
    severity: { type: String, enum: ['info', 'positive', 'warning', 'critical'], default: 'info' },
    headline: { type: String, required: true, maxlength: 200 },
    what: { type: String, required: true },
    period: { from: { type: Date, required: true }, to: { type: Date, required: true } },
    calculation: { type: String, required: true }, // human-readable derivation from real figures
    why: { type: String, required: true },
    dismissedAt: Date,
  },
  baseOptions,
);
financialInsightSchema.index({ userId: 1, ruleId: 1, 'period.from': 1 }, { unique: true });
financialInsightSchema.index({ userId: 1, createdAt: -1 });

export const Bill: any = model('Bill', billSchema);
export const RecurringTransaction: any = model('RecurringTransaction', recurringTransactionSchema);
export const RecurringOccurrence: any = model('RecurringOccurrence', recurringOccurrenceSchema);
export const Subscription: any = model('Subscription', subscriptionSchema);
export const Notification: any = model('Notification', notificationSchema);
export const FinancialInsight: any = model('FinancialInsight', financialInsightSchema);
