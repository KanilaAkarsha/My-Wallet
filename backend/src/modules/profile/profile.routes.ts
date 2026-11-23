import { Router } from 'express';
import { z } from 'zod';
import { Account, AuditLog, Attachment, Bill, Budget, Category, Debt, DebtPayment, FinancialInsight, IdempotencyRecord, Notification, Profile, RecurringOccurrence, RecurringTransaction, SavingsContribution, SavingsGoal, Session, Subscription, Transaction, User, BillingSubscription, Payment } from '../../database/models/index.js';
import { authed, requireAuth, SESSION_COOKIE } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { authLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { allBalances } from '../../services/ledger.service.js';
import { isSupportedCurrency } from '../../services/finance/money.js';
import { badRequest, unauthorized } from '../../shared/errors.js';
import { currencyCode, decimal, h, jsonSafe, money, signedDecimal, toMinor } from '../../shared/http.js';
import { verifyPassword } from '../auth/password.js';
import { effectivePlan } from '../billing/limits.js';
import { env } from '../../config/env.js';

const dto = (p: any) => ({
  displayName: p.displayName ?? null, country: p.country, currency: p.currency, timezone: p.timezone, incomeRange: p.incomeRange ?? null, occupation: p.occupation ?? null,
  modes: { student: !!p.modes?.student, youngProfessional: !!p.modes?.youngProfessional }, goals: p.goals ?? [], theme: p.theme, hideBalances: !!p.hideBalances,
  notificationPrefs: { inApp: p.notificationPrefs?.inApp !== false, email: !!p.notificationPrefs?.email, maskAmounts: p.notificationPrefs?.maskAmounts !== false },
  privacy: { aiExplanationsConsent: !!p.privacy?.aiExplanationsConsent, analyticsConsent: !!p.privacy?.analyticsConsent },
  onboardingCompleted: !!p.onboardingCompletedAt,
});

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const patch = z.object({
  displayName: z.string().trim().min(1).max(80), country: z.string().length(2).toUpperCase(), currency: currencyCode, timezone: z.string().max(60).refine(validTz, 'Unknown timezone'),
  incomeRange: z.enum(['<50k', '50k-100k', '100k-250k', '250k-500k', '500k+']).nullable(), occupation: z.enum(['student', 'employed', 'freelancer', 'other']).nullable(),
  modes: z.object({ student: z.boolean(), youngProfessional: z.boolean() }).partial(), goals: z.array(z.string().trim().max(60)).max(12), theme: z.enum(['light', 'dark', 'system']), hideBalances: z.boolean(),
  notificationPrefs: z.object({ inApp: z.boolean(), email: z.boolean(), maskAmounts: z.boolean() }).partial(),
  privacy: z.object({ aiExplanationsConsent: z.boolean(), analyticsConsent: z.boolean() }).partial(),
}).partial().strict();

const onboarding = z.object({
  displayName: z.string().trim().min(1).max(80).optional(), country: z.string().length(2).toUpperCase().default('LK'), currency: currencyCode.default('LKR'),
  incomeRange: z.enum(['<50k', '50k-100k', '100k-250k', '250k-500k', '500k+']).nullable().optional(), occupation: z.enum(['student', 'employed', 'freelancer', 'other']).nullable().optional(),
  goals: z.array(z.string().trim().max(60)).max(12).default([]),
  accounts: z.array(z.object({ name: z.string().trim().min(1).max(80), type: z.enum(['cash', 'savings', 'current', 'bank', 'ewallet', 'other']), startingBalance: signedDecimal.default('0') }).strict()).max(10).default([]),
}).strict(); // every field is optional/skippable; income is never required

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const p = (await Profile.findOne({ userId }).lean()) ?? (await Profile.create({ userId }));
  const plan = await effectivePlan(userId);
  res.json({ ...dto(p), plan: { code: plan.code, status: plan.status } });
}));

profileRouter.patch('/', validate({ body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof patch>;
  if (b.currency && !isSupportedCurrency(b.currency)) throw badRequest('Unsupported currency');
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [kk, vv] of Object.entries(v)) set[`${k}.${kk}`] = vv;
    else set[k] = v;
  }
  const p = await Profile.findOneAndUpdate({ userId }, { $set: set }, { new: true, upsert: true, runValidators: true }).lean();
  res.json(dto(p));
}));

/** Onboarding wizard: every step optional; creates the first accounts with their starting balances. */
profileRouter.post('/onboarding', idempotent(), validate({ body: onboarding }), h(async (req, res) => {
  const { userId } = authed(req);
  const b = req.body as z.infer<typeof onboarding>;
  if (!isSupportedCurrency(b.currency)) throw badRequest('Unsupported currency');
  const plan = await effectivePlan(userId);
  const existing = await Account.countDocuments({ userId, deletedAt: null, status: 'active' });
  const limit = plan.limits.accounts ?? 3;
  if (existing + b.accounts.length > limit) throw badRequest(`Your plan allows ${limit} accounts`);
  const set: Record<string, unknown> = { country: b.country, currency: b.currency, goals: b.goals, onboardingCompletedAt: new Date() };
  if (b.displayName) set.displayName = b.displayName;
  if (b.incomeRange !== undefined) set.incomeRange = b.incomeRange;
  if (b.occupation !== undefined) { set.occupation = b.occupation; set['modes.student'] = b.occupation === 'student'; set['modes.youngProfessional'] = b.occupation === 'employed'; }
  await Profile.updateOne({ userId }, { $set: set }, { upsert: true });
  for (const a of b.accounts) {
    try {
      await Account.create({ userId, name: a.name, type: a.type, currency: b.currency, openingBalanceMinor: toMinor(a.startingBalance, b.currency) });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // same-name account already exists: skip
    }
  }
  const balances = await allBalances(userId);
  res.status(201).json({ profile: dto((await Profile.findOne({ userId }).lean())!), accounts: [...balances.values()].map(({ account, balanceMinor }) => ({ id: String(account._id), name: account.name, balance: money(balanceMinor, account.currency) })) });
}));

/** Full personal data export (JSON). Strictly this user's records; secrets and hashes are excluded. */
profileRouter.get('/export', authLimiter(), h(async (req, res) => {
  const { userId } = authed(req);
  const get = (m: any, f: Record<string, unknown> = { userId }) => m.find(f).lean();
  const [user, profile, accounts, transactions, categories, budgets, goals, contributions, debts, debtPayments, bills, recurring, subscriptions, notifications, insights, billing, payments] = await Promise.all([
    User.findById(userId).select('email role createdAt emailVerifiedAt').lean(), Profile.findOne({ userId }).lean(), get(Account), get(Transaction), get(Category), get(Budget), get(SavingsGoal), get(SavingsContribution), get(Debt), get(DebtPayment), get(Bill), get(RecurringTransaction), get(Subscription), get(Notification), get(FinancialInsight), BillingSubscription.findOne({ userId }).select('-providerCustomerId -providerSubscriptionId').lean(), get(Payment),
  ]);
  const body = jsonSafe({ exportedAt: new Date().toISOString(), format: 'mywallet-export/1', note: 'Money fields ending in "Minor" are integers in the currency’s minor unit (LKR: 1/100).', user, profile, accounts, transactions, categories: (categories as any[]).filter((c) => c.userId), budgets, savingsGoals: goals, savingsContributions: contributions, debts, debtPayments, bills, recurringTransactions: recurring, subscriptions, notifications, financialInsights: insights, billing, payments });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mywallet-export.json"');
  res.send(JSON.stringify(body, null, 2));
}));

/**
 * Account deletion: requires the password; revokes every session and schedules a purge after the
 * retention window (30 days) during which the user can contact support to cancel. The e-mail is freed immediately.
 */
profileRouter.post('/delete-account', authLimiter(), validate({ body: z.object({ password: z.string().min(1).max(128), confirm: z.literal('DELETE') }).strict() }), h(async (req, res) => {
  const { userId } = authed(req);
  const u: any = await User.findById(userId).select('+passwordHash');
  if (!u || !(await verifyPassword(u.passwordHash, req.body.password))) throw unauthorized('Password is incorrect');
  await User.updateOne({ _id: userId }, { $set: { status: 'deleted', deletionRequestedAt: new Date(), email: `deleted+${userId}@invalid.local` } });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await AuditLog.create({ userId, action: 'account.deletion_requested', entity: 'user', entityId: userId, requestId: req.id });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ message: `Your account is closed. Your data will be permanently erased after ${RETENTION_DAYS} days.` });
}));

export const RETENTION_DAYS = 30;

/** Hard purge of one user's data. Called by the retention job; also usable by support tooling. */
export async function purgeUser(userId: string): Promise<void> {
  const models = [Transaction, Account, Category, Budget, SavingsGoal, SavingsContribution, Debt, DebtPayment, Bill, RecurringTransaction, RecurringOccurrence, Subscription, Notification, FinancialInsight, Attachment, IdempotencyRecord, Session, Profile, BillingSubscription, Payment];
  for (const m of models) await m.deleteMany({ userId });
  await AuditLog.updateMany({ userId }, { $unset: { ipPrefix: 1, meta: 1 } }); // keep minimal security trail without personal data
  await User.deleteOne({ _id: userId, status: 'deleted' });
}

export const _e = [env, decimal];
