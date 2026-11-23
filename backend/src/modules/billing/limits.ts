import type { RequestHandler } from 'express';
import type { Model } from 'mongoose';
import { BillingSubscription, SubscriptionPlan } from '../../database/models/index.js';
import { AppError } from '../../shared/errors.js';
import { PLAN_DEFAULTS } from '../../services/seed.js';

export type LimitKey = 'accounts' | 'budgets' | 'savingsGoals' | 'recurring';

export interface EffectivePlan {
  code: 'free' | 'plus' | 'premium';
  status: string;
  features: string[];
  limits: Record<string, number>;
}

/** Expired trials/cancelled periods fall back to Free for NEW capabilities only; stored history is never touched. */
export async function effectivePlan(userId: string): Promise<EffectivePlan> {
  const sub = await BillingSubscription.findOne({ userId }).lean();
  let code: EffectivePlan['code'] = 'free';
  let status = 'active';
  if (sub) {
    const now = new Date();
    const live =
      (sub.status === 'trialing' && sub.trialEndsAt && sub.trialEndsAt > now) ||
      (sub.status === 'active' && (!sub.currentPeriodEnd || sub.currentPeriodEnd > now)) ||
      (sub.status === 'cancelled' && sub.currentPeriodEnd && sub.currentPeriodEnd > now); // paid-through period
    if (live) {
      code = sub.planCode;
      status = sub.status;
    } else status = sub.status === 'trialing' ? 'expired' : sub.status;
  }
  const plan = await SubscriptionPlan.findOne({ code }).lean();
  const fallback = PLAN_DEFAULTS.find((p) => p.code === code)!;
  return {
    code,
    status,
    features: (plan?.features as string[]) ?? [...fallback.features],
    limits: { ...fallback.limits, ...((plan?.limits as Record<string, number>) ?? {}) },
  };
}

const paywall = (msg: string, extra: object) => new AppError(402, 'PLAN_LIMIT', msg, extra);

/** Blocks creating NEW records past the plan limit. Reading/editing existing records is never blocked. */
export const enforceLimit =
  (key: LimitKey, model: Model<any>, countFilter: Record<string, unknown> = {}): RequestHandler =>
  async (req, _res, next) => {
    try {
      const userId = req.auth!.userId;
      const plan = await effectivePlan(userId);
      const limit = plan.limits[key] ?? 0;
      const used = await model.countDocuments({ userId, deletedAt: null, ...countFilter });
      if (used >= limit) throw paywall(`Your ${plan.code} plan allows ${limit} ${key}. Upgrade to add more.`, { plan: plan.code, limit, used, key });
      next();
    } catch (e) {
      next(e);
    }
  };

export const requireFeature =
  (feature: string): RequestHandler =>
  async (req, _res, next) => {
    try {
      const plan = await effectivePlan(req.auth!.userId);
      if (!plan.features.includes(feature)) throw paywall(`This feature needs a higher plan`, { plan: plan.code, feature });
      next();
    } catch (e) {
      next(e);
    }
  };
