import "server-only";
import { env } from "./env";
import { store } from "./store";

/**
 * Rate limits and daily quotas.
 * Fixed windows counted in the store: PostgreSQL when DATABASE_URL is set
 * (shared across instances and restarts), otherwise in this process. The
 * client key is the signed-in user id when there is one, else the client IP
 * taken from proxy headers ONLY when TRUST_PROXY_HEADERS is on.
 */

export interface LimitResult { ok: boolean; remaining: number; retryAfter: number }

export async function rateLimit(key: string, perMinute: number): Promise<LimitResult> {
  const windowMs = 60_000;
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const count = await store().rateHit(`m:${key}`, windowStart, windowMs);
  if (count > perMinute) return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  return { ok: true, remaining: perMinute - count, retryAfter: 0 };
}

/** Per-day quota (UTC day), for expensive endpoints such as AI and outbound web fetches. */
export async function dailyQuota(key: string, perDay: number): Promise<LimitResult> {
  if (!perDay || perDay <= 0) return { ok: true, remaining: Infinity, retryAfter: 0 };
  const windowMs = 86_400_000;
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const count = await store().rateHit(`d:${key}`, windowStart, windowMs);
  if (count > perDay) return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  return { ok: true, remaining: perDay - count, retryAfter: 0 };
}

/** Client IP: the nearest proxy's entry in X-Forwarded-For when proxies are trusted; otherwise no header is believed. */
export function clientIp(req: Request): string {
  if (env.trustProxyHeaders) {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) {
      const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
      // Rightmost entry was appended by the trusted proxy in front of us; earlier entries are client-supplied.
      const ip = parts[parts.length - 1];
      if (ip && /^[0-9a-f.:]+$/i.test(ip)) return ip;
    }
    const real = req.headers.get("x-real-ip");
    if (real && /^[0-9a-f.:]+$/i.test(real)) return real;
  }
  return "direct";
}

export function clientKey(req: Request, userId?: string): string {
  if (userId) return `u:${userId}`;
  return `ip:${clientIp(req)}`;
}
