import { RecurringOccurrence, RecurringTransaction, Transaction } from '../../database/models/index.js';
import { occurrencesUntil } from '../../services/recurrence.js';
import { logger } from '../../shared/logger.js';

/**
 * Generates due occurrences. Safe to run any number of times, concurrently:
 *  1. RecurringOccurrence has a UNIQUE (userId, scheduleId, occurrenceDate) index — only one worker claims it.
 *  2. The transaction carries idempotencyKey `rec:<schedule>:<date>` (unique per user) — it can never be created twice.
 * A claimed occurrence whose transaction failed is retried on the next run.
 */
export async function generateRecurring(userId: string, now = new Date(), scheduleId?: string): Promise<{ created: number; retried: number; failed: number }> {
  const stats = { created: 0, retried: 0, failed: 0 };
  const schedules: any[] = await RecurringTransaction.find({ userId, deletedAt: null, status: 'active', ...(scheduleId ? { _id: scheduleId } : {}) });
  for (const s of schedules) {
    const rec = s.recurrence;
    const dates = occurrencesUntil({ frequency: rec.frequency, intervalDays: rec.intervalDays, startDate: rec.startDate, endDate: rec.endDate, timezone: rec.timezone }, now, { after: s.lastGeneratedThrough ?? undefined });
    // Also revisit earlier claimed-but-failed occurrences.
    const failed: any[] = await RecurringOccurrence.find({ userId, scheduleId: s._id, status: 'failed', transactionId: null }).lean();
    const todo = [...failed.map((f) => ({ date: f.occurrenceDate as Date, retry: true })), ...dates.map((d) => ({ date: d, retry: false }))];
    for (const { date, retry } of todo) {
      try {
        let claimed = retry;
        if (!retry) {
          try {
            await RecurringOccurrence.create({ userId, scheduleId: s._id, occurrenceDate: date, status: 'failed' });
            claimed = true;
          } catch (e) {
            if ((e as { code?: number }).code !== 11000) throw e;
            claimed = false; // another run owns it (or it is done)
          }
        }
        if (!claimed) continue;
        let tx: any;
        try {
          tx = await Transaction.create({
            userId, accountId: s.accountId, type: s.type, status: s.autoPost ? 'posted' : 'pending', title: s.title, amountMinor: s.amountMinor, currency: s.currency,
            categoryId: s.categoryId, transactionDate: date, billId: s.billId, subscriptionId: s.subscriptionId, recurringOccurrenceId: undefined,
            idempotencyKey: `rec:${s._id}:${date.toISOString()}`,
          });
        } catch (e) {
          if ((e as { code?: number }).code !== 11000) throw e;
          tx = await Transaction.findOne({ userId, idempotencyKey: `rec:${s._id}:${date.toISOString()}` }); // already created earlier
        }
        await RecurringOccurrence.updateOne({ userId, scheduleId: s._id, occurrenceDate: date }, { $set: { transactionId: tx._id, status: 'generated', error: null } });
        retry ? stats.retried++ : stats.created++;
      } catch (e) {
        stats.failed++;
        await RecurringOccurrence.updateOne({ userId, scheduleId: s._id, occurrenceDate: date }, { $set: { status: 'failed', error: String((e as Error).name).slice(0, 100) } }).catch(() => undefined);
        logger.warn({ scheduleId: String(s._id), errName: (e as Error).name }, 'recurring occurrence failed');
      }
    }
    if (dates.length) {
      s.lastGeneratedThrough = dates[dates.length - 1];
      await s.save();
    }
  }
  return stats;
}
