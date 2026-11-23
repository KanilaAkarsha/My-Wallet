import type { Options, Store, ClientRateLimitInfo } from 'express-rate-limit';
import type { Redis } from 'ioredis';

/**
 * Fixed-window store for express-rate-limit. Shares counters via Redis when available (decided per request, so
 * module load needs no env); otherwise falls back to per-process memory so limiting is never silently disabled.
 */
export class RedisRateLimitStore implements Store {
  private windowMs = 60_000;
  private mem = new Map<string, { hits: number; reset: number }>();
  constructor(private readonly client: () => Redis | null, private readonly keyPrefix: string) {}
  init(options: Options): void { this.windowMs = options.windowMs; }
  private k(key: string) { return `${this.keyPrefix}:${key}`; }

  private memIncrement(key: string): ClientRateLimitInfo {
    const now = Date.now();
    const cur = this.mem.get(key);
    const e = cur && cur.reset > now ? cur : { hits: 0, reset: now + this.windowMs };
    e.hits++;
    this.mem.set(key, e);
    if (this.mem.size > 50_000) for (const [k, v] of this.mem) if (v.reset <= now) this.mem.delete(k);
    return { totalHits: e.hits, resetTime: new Date(e.reset) };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const r = this.client();
    if (!r) return this.memIncrement(key);
    const k = this.k(key);
    try {
      const hits = await r.incr(k);
      if (hits === 1) await r.pexpire(k, this.windowMs);
      const ttl = await r.pttl(k);
      return { totalHits: hits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
    } catch {
      return this.memIncrement(key); // Redis hiccup: degrade to per-process limiting instead of failing requests
    }
  }
  async decrement(key: string): Promise<void> { const e = this.mem.get(key); if (e && e.hits > 0) e.hits--; await this.client()?.decr(this.k(key)); }
  async resetKey(key: string): Promise<void> { this.mem.delete(key); await this.client()?.del(this.k(key)); }
}
