import "server-only";

/**
 * Sliding-window rate limiter. In-memory per process; good for a single
 * container. For multi-instance deployments swap this for Redis (see
 * docs/DEPLOYMENT.md) keeping the same interface.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, perMinute: number): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= perMinute) {
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfter: Math.ceil((hits[0] + 60_000 - now) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => t > windowStart)) buckets.delete(k);
  }
  return { ok: true, remaining: perMinute - hits.length, retryAfter: 0 };
}

export function clientKey(req: Request, userId?: string): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return `ip:${fwd || req.headers.get("x-real-ip") || "local"}`;
}
