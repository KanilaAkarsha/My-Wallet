import { Category, SubscriptionPlan } from '../database/models/index.js';
import { logger } from '../shared/logger.js';

export const DEFAULT_EXPENSE_CATEGORIES = ['Food', 'Transport', 'Education', 'Accommodation', 'Shopping', 'Healthcare', 'Utilities', 'Entertainment', 'Communication', 'Subscriptions', 'Travel', 'Personal care', 'Other'];
export const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Allowance', 'Scholarship', 'Freelance', 'Business income', 'Investment income', 'Gifts', 'Other income'];

export const PLAN_DEFAULTS = [
  {
    code: 'free', name: 'Free', priceMinor: 0n, trialDays: 0,
    limits: { accounts: 3, budgets: 3, savingsGoals: 0, recurring: 0, reportMonths: 3 },
    features: ['accounts.basic', 'budgets.basic'],
  },
  {
    code: 'plus', name: 'Plus', priceMinor: 49900n, trialDays: 14,
    limits: { accounts: 10, budgets: 20, savingsGoals: 10, recurring: 25, reportMonths: 24 },
    features: ['accounts.basic', 'budgets.basic', 'reports.advanced', 'goals', 'recurring', 'bills', 'subscriptions'],
  },
  {
    code: 'premium', name: 'Premium', priceMinor: 99900n, trialDays: 14,
    limits: { accounts: 100, budgets: 200, savingsGoals: 100, recurring: 200, reportMonths: 600 }, // fair-use ceilings
    features: ['accounts.basic', 'budgets.basic', 'reports.advanced', 'goals', 'recurring', 'bills', 'subscriptions', 'insights', 'analytics.advanced', 'exports.advanced', 'support.priority'],
  },
] as const;

/** Idempotent upserts. Prices are placeholders to be set per market before launch. */
export async function seedSystemData(): Promise<void> {
  for (const [kind, names] of [['expense', DEFAULT_EXPENSE_CATEGORIES], ['income', DEFAULT_INCOME_CATEGORIES]] as const) {
    for (const name of names) {
      await Category.updateOne({ userId: null, kind, name }, { $setOnInsert: { userId: null, kind, name, isSystem: true } }, { upsert: true });
    }
  }
  for (const p of PLAN_DEFAULTS) {
    await SubscriptionPlan.updateOne({ code: p.code }, { $setOnInsert: { ...p, currency: 'LKR', interval: 'month', active: true } }, { upsert: true });
  }
  logger.info('system data seeded');
}
