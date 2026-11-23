import { Bill, Budget, Debt, Notification, Profile, Subscription, User } from '../../database/models/index.js';
import { getMailer } from '../auth/mailer.js';
import { budgetDto } from '../budgets/budgets.service.js';
import { milestoneReached } from '../../services/goals.js';
import { logger } from '../../shared/logger.js';
import { money } from '../../shared/http.js';

export interface NotifyInput {
  type: string;
  title: string;
  /** Text WITHOUT amounts. `detail` (with amounts) is only included if the user allows it. */
  body?: string;
  detail?: string;
  link?: string;
  dedupeKey: string;
}

/** Creates an in-app notification (deduplicated) and optionally emails it. Amounts are masked by default. */
export async function notify(userId: string, n: NotifyInput): Promise<boolean> {
  const prof: any = await Profile.findOne({ userId }).lean();
  const prefs = prof?.notificationPrefs ?? { inApp: true, email: false, maskAmounts: true };
  const body = [n.body, prefs.maskAmounts ? undefined : n.detail].filter(Boolean).join(' ').slice(0, 400) || undefined;
  if (prefs.inApp !== false) {
    try {
      await Notification.create({ userId, type: n.type, title: n.title.slice(0, 120), body, link: n.link, dedupeKey: n.dedupeKey });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false; // already sent
      throw e;
    }
  }
  if (prefs.email) {
    const u: any = await User.findById(userId).select('email emailVerifiedAt').lean();
    if (u?.emailVerifiedAt) await getMailer().send({ to: u.email, subject: n.title, text: body ?? n.title }).catch((e) => logger.warn({ errName: (e as Error).name }, 'notification email failed'));
  }
  return true;
}

export async function notifyMilestone(userId: string, goal: any, before: number, after: number) {
  const m = milestoneReached(before, after);
  if (!m) return;
  await notify(userId, {
    type: 'savings_milestone',
    title: m === 100 ? `Goal reached: ${goal.name}` : `${m}% of your "${goal.name}" goal`,
    body: m === 100 ? 'You have reached your savings goal.' : 'Nice progress on your savings goal.',
    link: `/goals/${goal._id}`,
    dedupeKey: `goal:${goal._id}:${m}`,
  });
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Idempotent: every notification has a dedupe key, so running twice (or concurrently) sends nothing new. */
export async function scanNotifications(userId: string, now = new Date()): Promise<number> {
  let created = 0;
  const count = async (p: Promise<boolean>) => void ((await p) && created++);

  const bills: any[] = await Bill.find({ userId, deletedAt: null, status: 'active' }).lean();
  for (const b of bills) {
    const days = Math.ceil((b.nextDueDate.getTime() - now.getTime()) / DAY);
    for (const r of (b.reminderDaysBefore as number[]) ?? [3, 1]) {
      if (days <= r && days >= 0) await count(notify(userId, { type: 'bill_due', title: `${b.name} is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`, detail: `Expected ${money(BigInt(b.expectedAmountMinor), b.currency)}.`, link: '/bills', dedupeKey: `bill:${b._id}:${isoDay(b.nextDueDate)}:${r}` }));
    }
    if (days < 0) await count(notify(userId, { type: 'bill_due', title: `${b.name} is overdue`, link: '/bills', dedupeKey: `bill:${b._id}:${isoDay(b.nextDueDate)}:overdue` }));
  }

  const subs: any[] = await Subscription.find({ userId, deletedAt: null, status: 'active' }).lean();
  for (const s of subs) {
    const days = Math.ceil((s.nextBillingDate.getTime() - now.getTime()) / DAY);
    if (days >= 0 && days <= 3) await count(notify(userId, { type: 'subscription_renewal', title: `${s.name} renews ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`, detail: `${money(BigInt(s.amountMinor), s.currency)} per ${s.billingFrequency}.`, link: '/subscriptions', dedupeKey: `sub:${s._id}:${isoDay(s.nextBillingDate)}` }));
  }

  const debts: any[] = await Debt.find({ userId, deletedAt: null, status: 'active', dueDate: { $ne: null } }).lean();
  for (const d of debts) {
    const days = Math.ceil((d.dueDate.getTime() - now.getTime()) / DAY);
    if (days >= 0 && days <= 5) await count(notify(userId, { type: 'debt_due', title: `Payment due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}: ${d.counterparty}`, link: `/debts/${d._id}`, dedupeKey: `debt:${d._id}:${isoDay(d.dueDate)}` }));
  }

  const budgets: any[] = await Budget.find({ userId, deletedAt: null, status: 'active', startDate: { $lte: now }, endDate: { $gt: now } }).lean();
  for (const b of budgets) {
    const dto: any = await budgetDto(userId, b);
    if (dto.health === 'exceeded') await count(notify(userId, { type: 'budget_alert', title: `You exceeded your budget: ${b.name}`, detail: `Spent ${dto.spent} of ${dto.amount}.`, link: `/budgets/${b._id}`, dedupeKey: `budget:${b._id}:${isoDay(b.startDate)}:exceeded` }));
    else if (dto.health === 'warning') await count(notify(userId, { type: 'budget_alert', title: `You are close to your budget limit: ${b.name}`, detail: `${dto.percentUsed}% used.`, link: `/budgets/${b._id}`, dedupeKey: `budget:${b._id}:${isoDay(b.startDate)}:warning` }));
  }
  return created;
}
