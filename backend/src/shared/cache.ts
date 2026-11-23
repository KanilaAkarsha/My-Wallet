import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Optional Redis cache for READ-ONLY derived views (chart series, report tables).
 * Rules: keys always contain the user id; a per-user version number is bumped on every successful write,
 * so stale data cannot outlive a change; balances and anything authoritative are NEVER served from here.
 */
let client: Redis | null | undefined;
export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = env().REDIS_URL;
  if (!url) return (client = null);
  client = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
  client.on('error', (e) => logger.warn({ errName: e.name }, 'redis error'));
  return client;
}
export async function closeRedis(): Promise<void> {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}

const verKey = (userId: string) => `mw:u:${userId}:ver`;

export async function bumpVersion(userId: string): Promise<void> {
  try {
    await redis()?.incr(verKey(userId));
  } catch {
    /* cache is best-effort */
  }
}

export async function cached<T>(userId: string, name: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const r = redis();
  if (!r) return compute();
  try {
    const ver = (await r.get(verKey(userId))) ?? '0';
    const key = `mw:u:${userId}:v${ver}:${name}`;
    const hit = await r.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await compute();
    await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  } catch {
    return compute();
  }
}
