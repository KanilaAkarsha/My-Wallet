import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

/**
 * Global Mongoose options (shared with tests).
 * NOTE: `sanitizeFilter` is deliberately OFF. It rewrites every nested `{ $gt/$in/... }` into `{ $eq: {...} }`, which breaks
 * all of this codebase's own range/set queries (e.g. session lookup → CastError). Operator injection is instead blocked at the
 * edge: `rejectInjection` refuses `$`/dotted keys in body/query/params, Zod schemas are `.strict()`, and ids are validated.
 */
export function configureMongoose(): void {
  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', false);
}

export async function connectDatabase(): Promise<typeof mongoose> {
  const e = env();
  configureMongoose();
  await mongoose.connect(e.MONGODB_URI, {
    maxPoolSize: e.MONGODB_MAX_POOL_SIZE,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    autoIndex: !e.isProd, // build indexes via an explicit migration step in production
  });
  logger.info('MongoDB connected');
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Multi-document transactions need a replica set (Atlas always is). Fails fast otherwise,
 * because silently running financial writes without atomicity would break the transfer guarantee.
 */
export async function assertTransactionsSupported(): Promise<void> {
  const admin = mongoose.connection.db?.admin();
  const hello = (await admin?.command({ hello: 1 })) as { setName?: string; msg?: string } | undefined;
  if (!hello?.setName && hello?.msg !== 'isdbgrid') {
    throw new Error('MongoDB must run as a replica set (or sharded cluster) for transactions. See docs/DEPLOYMENT.md.');
  }
}

export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    }) as T;
  } finally {
    await session.endSession();
  }
}
