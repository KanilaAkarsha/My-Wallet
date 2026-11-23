import './config/loadEnv.js'; // must stay first: imports are hoisted, so env loading lives in its own module
import { createApp } from './app.js';
import { env } from './config/env.js';
import { assertTransactionsSupported, connectDatabase, disconnectDatabase } from './database/connection.js';
import { startJobs, stopJobs } from './queues/index.js';
import { seedSystemData } from './services/seed.js';
import { closeRedis } from './shared/cache.js';
import { logger } from './shared/logger.js';

async function main() {
  const e = env(); // fails fast on invalid configuration
  await connectDatabase();
  await assertTransactionsSupported();
  await seedSystemData();
  // RUN_JOBS=false lets you run API-only instances and a dedicated worker instance.
  if (process.env.RUN_JOBS !== 'false') await startJobs();

  const server = createApp().listen(e.PORT, () => logger.info({ port: e.PORT }, 'API listening'));
  server.requestTimeout = e.REQUEST_TIMEOUT_MS;
  server.headersTimeout = e.REQUEST_TIMEOUT_MS + 1000;

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15000);
    force.unref();
    server.close(async () => {
      await stopJobs().catch(() => undefined);
      await closeRedis();
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ errName: (err as Error).name, msg: (err as Error).message }, 'startup failed');
  process.exit(1);
});
