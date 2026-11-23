import { describe, expect, it } from 'vitest';
import { RedisRateLimitStore } from './redisStore.js';

class FakeRedis {
  data = new Map<string, number>();
  async incr(k: string) { const v = (this.data.get(k) ?? 0) + 1; this.data.set(k, v); return v; }
  async pexpire() { return 1; }
  async pttl() { return 30_000; }
  async decr(k: string) { this.data.set(k, (this.data.get(k) ?? 1) - 1); }
  async del(k: string) { this.data.delete(k); }
}

describe('RedisRateLimitStore', () => {
  it('counts hits per key, decrements and resets', async () => {
    const s = new RedisRateLimitStore(() => new FakeRedis() as any, 'p');
    const r = new FakeRedis();
    const store = new RedisRateLimitStore(() => r as any, 'p');
    store.init({ windowMs: 60_000 } as any);
    expect((await store.increment('ip1')).totalHits).toBe(1);
    expect((await store.increment('ip1')).totalHits).toBe(2);
    expect((await store.increment('ip2')).totalHits).toBe(1);
    await store.decrement('ip1');
    expect((await store.increment('ip1')).totalHits).toBe(2);
    await store.resetKey('ip1');
    expect((await store.increment('ip1')).totalHits).toBe(1);
    expect(s).toBeDefined();
  });
  it('falls back to in-memory counting (never disables limiting) without Redis', async () => {
    const s = new RedisRateLimitStore(() => null, 'p');
    s.init({ windowMs: 60_000 } as any);
    expect((await s.increment('x')).totalHits).toBe(1);
    expect((await s.increment('x')).totalHits).toBe(2);
    await s.resetKey('x');
    expect((await s.increment('x')).totalHits).toBe(1);
  });
});
