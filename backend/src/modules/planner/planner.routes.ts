import { Router } from 'express';
import { z } from 'zod';
import { Profile } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { allBalances, periodTotals, userProfile } from '../../services/ledger.service.js';
import { dailyAllowance, daysBetween, emergencyCoverage, limitUsage, savingsRatePercent, splitGuideline } from '../../services/planner.js';
import { resolveRange } from '../../shared/dateRange.js';
import { decimal, h, isoDate, money, toMinor, zonedMidnight, zonedParts } from '../../shared/http.js';

const body = z.object({
  monthlyAllowance: decimal.nullable(), weeklyLimit: decimal.nullable(), semesterStart: isoDate.nullable(), semesterEnd: isoDate.nullable(),
  semesterBudget: decimal.nullable(), monthlySalary: decimal.nullable(), emergencyTargetMonths: z.number().int().min(1).max(24),
}).partial().strict();

const big = (s?: string | null) => (s ? BigInt(s) : null);
const EXP = { type: { $in: ['expense', 'refund', 'loan_interest'] } };

export const plannerRouter = Router();
plannerRouter.use(requireAuth);

plannerRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const { currency, timezone: tz, profile } = await userProfile(userId);
  const pl = profile?.planner ?? {};
  const now = new Date();
  const month = resolveRange('this_month', tz, now);
  const week = resolveRange('this_week', tz, now);
  const p = zonedParts(now, tz);
  const tomorrow = zonedMidnight(p.y, p.m, p.d + 1, tz);
  const out: Record<string, unknown> = { currency, modes: { student: !!profile?.modes?.student, youngProfessional: !!profile?.modes?.youngProfessional }, settings: {
    monthlyAllowance: money(big(pl.monthlyAllowanceMinor), currency), weeklyLimit: money(big(pl.weeklyLimitMinor), currency), semesterStart: pl.semesterStart ?? null, semesterEnd: pl.semesterEnd ?? null,
    semesterBudget: money(big(pl.semesterBudgetMinor), currency), monthlySalary: money(big(pl.monthlySalaryMinor), currency), emergencyTargetMonths: pl.emergencyTargetMonths ?? 6 } };

  const mt = await periodTotals(userId, month.from, month.to);
  const fmtPace = (r: ReturnType<typeof limitUsage>, daysLeft: number) => ({ spent: money(r.spentMinor, currency), limit: money(r.limitMinor, currency), remaining: money(r.remainingMinor, currency), percentUsed: r.percentUsed, status: r.status, safeDailySpend: money(dailyAllowance(r.remainingMinor, daysLeft), currency), daysLeft });

  const weeklyLimit = big(pl.weeklyLimitMinor);
  if (weeklyLimit) { const wt = await periodTotals(userId, week.from, week.to, EXP); const daysLeft = daysBetween(tomorrow, new Date(week.from.getTime() + 7 * 86_400_000)) + 1; out.weekly = fmtPace(limitUsage(wt.expenseMinor, weeklyLimit), Math.min(daysLeft, 7)); }

  const allowance = big(pl.monthlyAllowanceMinor);
  if (allowance) out.allowance = fmtPace(limitUsage(mt.expenseMinor, allowance), Math.max(1, daysBetween(tomorrow, month.to) + 1));

  const semBudget = big(pl.semesterBudgetMinor);
  if (semBudget && pl.semesterStart && pl.semesterEnd) {
    const st = await periodTotals(userId, pl.semesterStart, pl.semesterEnd, EXP);
    const left = pl.semesterEnd > now ? daysBetween(now, pl.semesterEnd) : 0;
    out.semester = { ...fmtPace(limitUsage(st.expenseMinor, semBudget), left), start: pl.semesterStart, end: pl.semesterEnd };
  }

  const salary = big(pl.monthlySalaryMinor);
  if (salary) { const g = splitGuideline(salary); out.salaryPlan = { salary: money(salary, currency), needs: money(g.needsMinor, currency), wants: money(g.wantsMinor, currency), savings: money(g.savingsMinor, currency), note: '50/30/20 is a common guideline, not personalised advice.' }; }

  // Emergency fund: savings-type accounts vs average monthly expenses of the last 3 full months.
  const from3 = zonedMidnight(p.y, p.m - 3, 1, tz);
  const t3 = await periodTotals(userId, from3, month.from, EXP);
  const avg = t3.expenseMinor / 3n;
  let fund = 0n;
  for (const { account, balanceMinor } of (await allBalances(userId)).values()) if (account.type === 'savings' && account.currency === currency) fund += balanceMinor;
  const cov = emergencyCoverage(fund, avg, pl.emergencyTargetMonths ?? 6);
  out.emergencyFund = { fund: money(fund, currency), avgMonthlyExpenses: money(avg, currency), monthsCovered: cov.months, targetMonths: pl.emergencyTargetMonths ?? 6, target: money(cov.targetMinor, currency), shortfall: money(cov.shortfallMinor, currency), basis: 'Balances of your Savings-type accounts vs average expenses of the last 3 full months.' };
  out.savingsRatePercent = savingsRatePercent(mt.incomeMinor, mt.expenseMinor);
  res.json(out);
}));

plannerRouter.put('/', validate({ body }), h(async (req, res) => {
  const { userId } = authed(req);
  const { currency } = await userProfile(userId);
  const b = req.body as z.infer<typeof body>;
  const set: Record<string, unknown> = {};
  const minor = (k: keyof typeof b, f: string) => { if (k in b) set[`planner.${f}`] = b[k] == null ? null : toMinor(String(b[k]), currency).toString(); };
  minor('monthlyAllowance', 'monthlyAllowanceMinor'); minor('weeklyLimit', 'weeklyLimitMinor'); minor('semesterBudget', 'semesterBudgetMinor'); minor('monthlySalary', 'monthlySalaryMinor');
  if ('semesterStart' in b) set['planner.semesterStart'] = b.semesterStart ?? null;
  if ('semesterEnd' in b) set['planner.semesterEnd'] = b.semesterEnd ?? null;
  if (b.emergencyTargetMonths) set['planner.emergencyTargetMonths'] = b.emergencyTargetMonths;
  await Profile.updateOne({ userId }, { $set: set }, { upsert: true });
  res.json({ saved: true });
}));
