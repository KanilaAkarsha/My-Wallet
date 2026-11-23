/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, model } from 'mongoose';
import { baseOptions, currencyField, minorField, ref, softDelete, userRef } from './common.js';

const accountSchema = new Schema<any>(
  {
    userId: userRef(),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['cash', 'savings', 'current', 'bank', 'ewallet', 'other'], required: true },
    currency: { ...currencyField(), immutable: true },
    openingBalanceMinor: minorField(),
    notes: { type: String, maxlength: 500 },
    hidden: { type: Boolean, default: false }, // hide sensitive account info in UI
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    lastReconciledAt: Date,
    lastStatementBalanceMinor: minorField({ required: false }),
    ...softDelete,
  },
  baseOptions,
);
accountSchema.index({ userId: 1, status: 1 });
accountSchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

const categorySchema = new Schema<any>(
  {
    userId: { ...userRef(), required: false }, // null = system default category
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ['income', 'expense'], required: true },
    isSystem: { type: Boolean, default: false },
    icon: { type: String, maxlength: 40 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    archivedAt: { type: Date, default: null },
  },
  baseOptions,
);
categorySchema.index({ userId: 1, kind: 1, name: 1 }, { unique: true });

const transactionSchema = new Schema<any>(
  {
    userId: userRef(),
    accountId: { ...ref('Account', true), immutable: true },
    type: {
      type: String,
      enum: ['income', 'expense', 'transfer', 'refund', 'adjustment', 'loan_interest'],
      required: true,
      immutable: true,
    },
    direction: { type: String, enum: ['in', 'out'] }, // required for transfer/adjustment
    status: { type: String, enum: ['pending', 'posted', 'reversed', 'failed'], default: 'pending' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amountMinor: minorField({ min: 1n }),
    currency: { ...currencyField(), immutable: true },
    categoryId: ref('Category'),
    transactionDate: { type: Date, required: true },
    description: { type: String, maxlength: 1000 },
    notes: { type: String, maxlength: 2000 },
    tags: { type: [{ type: String, trim: true, maxlength: 30 }], validate: (v: string[]) => v.length <= 15 },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: 'Attachment', default: [] },
    transferGroupId: { type: String, immutable: true },
    transferConversion: { rate: String, fromCurrency: String, toCurrency: String },
    reversalOf: { ...ref('Transaction'), immutable: true },
    reversedById: ref('Transaction'),
    refundOf: { ...ref('Transaction'), immutable: true },
    debtId: ref('Debt'),
    billId: ref('Bill'),
    subscriptionId: ref('Subscription'),
    savingsGoalId: ref('SavingsGoal'),
    recurringOccurrenceId: ref('RecurringOccurrence'),
    idempotencyKey: { type: String, maxlength: 100, immutable: true },
    postedAt: Date,
    ...softDelete,
  },
  baseOptions,
);

transactionSchema.index({ userId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, accountId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, type: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, categoryId: 1, transactionDate: -1 });
transactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
// One reversal per original; a transfer group has exactly two legs.
transactionSchema.index({ userId: 1, reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } });

transactionSchema.pre('validate', function (this: any, next: (e?: Error) => void) {
  if ((this.type === 'transfer' || this.type === 'adjustment') && !this.direction) {
    return next(new Error(`${this.type} requires a direction`));
  }
  if (this.type === 'transfer' && !this.transferGroupId) return next(new Error('transfer requires transferGroupId'));
  next();
});

/**
 * Immutability of financial history: once posted, the only permitted mutations are
 *   posted -> reversed (+ reversedById), and tags/notes/description/title/category metadata edits.
 * Amount, currency, account, type and dates are locked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;
const LOCKED_AFTER_POST = ['amountMinor', 'transactionDate', 'direction', 'userId'] as const;
transactionSchema.pre('save', async function (this: any, next: (e?: Error) => void) {
  if (this.isNew) {
    if (this.status === 'posted' && !this.postedAt) this.postedAt = new Date();
    return next();
  }
  const prev = await (this.constructor as any).findById(this._id).select('status').lean();
  if (!prev) return next();
  if (prev.status === 'posted' || prev.status === 'reversed') {
    for (const f of LOCKED_AFTER_POST) {
      if (this.isModified(f)) return next(new Error(`Posted transactions are immutable (${f}); create a reversal instead`));
    }
    if (this.isModified('status') && !(prev.status === 'posted' && this.status === 'reversed')) {
      return next(new Error('Invalid status transition for a posted transaction'));
    }
    if (this.isModified('deletedAt') && this.deletedAt) return next(new Error('Posted transactions cannot be deleted'));
  }
  if (this.isModified('status') && this.status === 'posted' && !this.postedAt) this.postedAt = new Date();
  next();
});

const budgetSchema = new Schema<any>(
  {
    userId: userRef(),
    name: { type: String, required: true, trim: true, maxlength: 80 },
    period: { type: String, enum: ['monthly', 'weekly', 'custom'], required: true },
    categoryIds: { type: [Schema.Types.ObjectId], ref: 'Category', default: [] }, // empty = overall
    amountMinor: minorField({ min: 1n }),
    currency: currencyField(),
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    month: { type: Number, min: 1, max: 12 },
    year: { type: Number, min: 2000, max: 2200 },
    warnAtPercent: { type: Number, min: 1, max: 100, default: 80 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    ...softDelete,
  },
  baseOptions,
);
budgetSchema.index({ userId: 1, month: 1, year: 1 });
budgetSchema.index({ userId: 1, status: 1, startDate: 1 });
budgetSchema.pre('validate', function (this: any, next: (e?: Error) => void) {
  if (this.endDate <= this.startDate) return next(new Error('endDate must be after startDate'));
  next();
});

export const Account: any = model('Account', accountSchema);
export const Category: any = model('Category', categorySchema);
export const Transaction: any = model('Transaction', transactionSchema);
export const Budget: any = model('Budget', budgetSchema);
