// LRU + TokenBucket (module-level 用)
// 注意: Netlify Function 实例冷启会重置 module-level 变量,
// 所以 in-memory cache 只是 best-effort 二级缓存
// 主缓存靠 Cache-Control header 让 Netlify Edge 做

export class LRU<K, V> {
  private map = new Map<K, { v: V; ts: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() - e.ts > this.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    // bump to most-recent
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, ts: Date.now() });
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  size(): number {
    return this.map.size;
  }
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucket {
  private buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMin: number;

  constructor(capacity: number, refillPerMin: number) {
    this.capacity = capacity;
    this.refillPerMin = refillPerMin;
  }

  tryConsume(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, b);
    } else {
      const elapsedMs = now - b.lastRefill;
      const refilled = (elapsedMs / 60000) * this.refillPerMin;
      b.tokens = Math.min(this.capacity, b.tokens + refilled);
      b.lastRefill = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  // 限内存增长 — 30 分钟没访问的 key 清掉 (best-effort, 不定时跑)
  gc(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, b] of this.buckets) {
      if (b.lastRefill < cutoff && b.tokens >= this.capacity) {
        this.buckets.delete(k);
      }
    }
  }
}
