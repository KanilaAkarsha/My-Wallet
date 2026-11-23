import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { User } from '../database/models/index.js';
import { computeInsights } from '../modules/insights/insights.service.js';
import { scanNotifications, notify } from '../modules/notifications/notifications.service.js';
import { generateRecurring } from '../modules/recurring/recurring.service.js';
import { RETENTION_DAYS, purgeUser } from '../modules/profile/profile.routes.js';
import { effectivePlan } from '../modules/billing/limits.js';
import { periodTotals, userProfile } from '../services/ledger.service.js';
import { bumpVersion } from '../shared/cache.js';
import { zonedMidnight, zonedParts, money } from '../shared/http.js';
import { logger } from '../shared/logger.js';

export const QUEUE = 'mywallet';
export type JobName = 'recurring.run' | 'notifications.scan' | 'insights.compute' | 'monthly.summary' | 'retention.purge';

/** Every handler is idempotent (unique indexes / dedupe keys), so BullMQ retries and double schedules are safe. */
export async function forEachUser(fn: (userId: string) => Promise<void>, filter: Record<string, unknown> = {}) {
  const cursor = User.find({ status: 'active', ...filter }).select('_id').lean().cursor({ batchSize: 200 });
  let n = 0;
  for await (const u of cursor as AsyncIterable<any>) {
    try { await fn(String(u._id)); n++; } catch (e) { logger.warn({ userId: String(u._id), errName: (e as Error).name }, 'job step failed'); }
  }
  return n;
}

export const handlers: Record<JobName, () => Promise<unknown>> = {
  'recurring.run': () => forEachUser(async (id) => { const r = await generateRecurring(id); if (r.created || r.retried) await bumpVersion(id); }),
  'notifications.scan': () => forEachUser(async (id) => void (await scanNotifications(id))),
  'insights.compute': () => forEachUser(async (id) => { if ((await effectivePlan(id)).features.includes('insights')) await computeInsights(id); }),
  'monthly.summary': () => forEachUser(async (id) => {
    const { timezone: tz, currency } = await userProfile(id);
    const p = zonedParts(new Date(), tz);
    const from = zonedMidnight(p.y, p.m - 1, 1, tz);
    const to = zonedMidnight(p.y, p.m, 1, tz);
    const t = await periodTotals(id, from, to);
    if (t.incomeMinor === 0n && t.expenseMinor === 0n) return;
    const label = `${zonedParts(from, tz).y}-${String(zonedParts(from, tz).m).padStart(2, '0')}`;
    await notify(id, { type: 'monthly_summary', title: `Your ${label} summary is ready`, body: 'See how last month went.', detail: `Income ${money(t.incomeMinor, currency)}, expenses ${money(t.expenseMinor, currency)}.`, link: '/reports', dedupeKey: `summary:${label}` });
  }),
  /** Permanently erases accounts whose deletion grace period has passed. Never touches active users. */
  'retention.purge': async () => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const due: any[] = await User.find({ status: 'deleted', deletionRequestedAt: { $lte: cutoff } }).select('_id').lean();
    for (const u of due) await purgeUser(String(u._id));
    return due.length;
  },
};

const SCHEDULE: { name: JobName; pattern: string }[] = [
  { name: 'recurring.run', pattern: '5 0 * * *' },
  { name: 'notifications.scan', pattern: '0 7 * * *' },
  { name: 'insights.compute', pattern: '30 2 * * *' },
  { name: 'monthly.summary', pattern: '0 8 1 * *' },
  { name: 'retention.purge', pattern: '0 3 * * *' },
];

let queue: Queue | undefined;
let worker: Worker | undefined;
let conn: Redis | undefined;

/** Starts scheduling + processing. No-op (with a warning) when REDIS_URL is not set. */
export async function startJobs(): Promise<boolean> {
  const url = env().REDIS_URL;
  if (!url) { logger.warn('REDIS_URL not set: background jobs are disabled (recurring/notifications run only via their API endpoints)'); return false; }
  conn = new Redis(url, { maxRetriesPerRequest: null });
  queue = new Queue(QUEUE, { connection: conn, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 50, removeOnFail: 200 } });
  for (const s of SCHEDULE) await queue.upsertJobScheduler(s.name, { pattern: s.pattern, tz: env().DEFAULT_TIMEZONE }, { name: s.name, data: {} });
  worker = new Worker(QUEUE, async (job: Job) => {
    const fn = handlers[job.name as JobName];
    if (!fn) throw new Error(`Unknown job ${job.name}`);
    const out = await fn();
    logger.info({ job: job.name, out: typeof out === 'number' ? out : undefined }, 'job done');
    return out;
  }, { connection: conn, concurrency: 2 });
  worker.on('failed', (j, e) => logger.error({ job: j?.name, errName: e.name }, 'job failed'));
  return true;
}

export async function stopJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await conn?.quit().catch(() => undefined);
}
