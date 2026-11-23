/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, model } from 'mongoose';
import { baseOptions, currencyField, minorField, ref, softDelete, userRef } from './common.js';

const savingsGoalSchema = new Schema<any>(
  {
    userId: userRef(),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 500 },
    targetMinor: minorField({ min: 1n }),
    currentMinor: { ...minorField(), default: 0n }, // derived from contributions; verified by a reconcile job
    currency: currencyField(),
    targetDate: Date,
    imageAttachmentId: ref('Attachment'),
    linkedAccountId: ref('Account'), // optional dedicated savings account
    status: { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },
    completedAt: Date,
    ...softDelete,
  },
  baseOptions,
);
savingsGoalSchema.index({ userId: 1, status: 1 });

const savingsContributionSchema = new Schema<any>(
  {
    userId: userRef(),
    goalId: { ...ref('SavingsGoal', true), immutable: true },
    accountId: ref('Account'), // source/destination account when money physically moves
    direction: { type: String, enum: ['contribution', 'withdrawal'], required: true, immutable: true },
    amountMinor: { ...minorField({ min: 1n }), immutable: true },
    currency: { ...currencyField(), immutable: true },
    date: { type: Date, required: true },
    note: { type: String, maxlength: 300 },
    idempotencyKey: { type: String, maxlength: 100 },
  },
  baseOptions,
);
savingsContributionSchema.index({ userId: 1, goalId: 1, date: -1 });
savingsContributionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

const debtSchema = new Schema<any>(
  {
    userId: userRef(),
    kind: { type: String, enum: ['personal_loan', 'borrowed', 'lent', 'credit_card', 'student_loan', 'installment'], required: true, immutable: true },
    counterparty: { type: String, required: true, trim: true, maxlength: 100 },
    currency: { ...currencyField(), immutable: true },
    originalPrincipalMinor: { ...minorField({ min: 1n }), immutable: true },
    outstandingPrincipalMinor: minorField({ min: 0n }),
    accruedInterestMinor: { ...minorField({ min: 0n }), default: 0n },
    interestRateBps: { type: Number, min: 0, max: 100000, default: 0 },
    interestMethod: { type: String, enum: ['none', 'simple', 'reducing_balance'], default: 'none' },
    paymentFrequency: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'yearly', 'one_time'], default: 'monthly' },
    startDate: { type: Date, required: true },
    dueDate: Date,
    interestAccruedThrough: Date,
    status: { type: String, enum: ['active', 'paid_off', 'archived'], default: 'active' },
    ...softDelete,
  },
  baseOptions,
);
debtSchema.index({ userId: 1, status: 1, dueDate: 1 });

const debtPaymentSchema = new Schema<any>(
  {
    userId: userRef(),
    debtId: { ...ref('Debt', true), immutable: true },
    accountId: ref('Account'),
    date: { type: Date, required: true },
    totalMinor: { ...minorField({ min: 1n }), immutable: true },
    principalMinor: { ...minorField({ min: 0n }), immutable: true },
    interestMinor: { ...minorField({ min: 0n }), immutable: true },
    currency: { ...currencyField(), immutable: true },
    interestTransactionId: ref('Transaction'),
    idempotencyKey: { type: String, maxlength: 100 },
  },
  baseOptions,
);
debtPaymentSchema.index({ userId: 1, debtId: 1, date: -1 });
debtPaymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
debtPaymentSchema.pre('validate', function (this: any, next: (e?: Error) => void) {
  if (this.principalMinor + this.interestMinor !== this.totalMinor) return next(new Error('principal + interest must equal total'));
  next();
});

export const SavingsGoal: any = model('SavingsGoal', savingsGoalSchema);
export const SavingsContribution: any = model('SavingsContribution', savingsContributionSchema);
export const Debt: any = model('Debt', debtSchema);
export const DebtPayment: any = model('DebtPayment', debtPaymentSchema);
