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

export interface Allowance { limit: number; used: number; remaining: number; resetsAt: number; windowHours: number }

/** Per-person allowance in fixed windows of `hours` (aligned to UTC). Peek only; call `consumeAllowance` to count a request. */
export async function peekAllowance(userId: string, limit: number, hours: number): Promise<Allowance> {
  const windowMs = Math.max(1, hours) * 3_600_000;
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const used = limit > 0 ? await store().ratePeek(`w:ai:${userId}`, windowStart) : 0;
  return { limit, used: Math.min(used, limit), remaining: Math.max(0, limit - used), resetsAt: windowStart + windowMs, windowHours: hours };
}

export async function consumeAllowance(userId: string, limit: number, hours: number): Promise<Allowance & { ok: boolean }> {
  if (!limit || limit <= 0) return { ok: true, limit: 0, used: 0, remaining: Infinity, resetsAt: 0, windowHours: hours };
  const windowMs = Math.max(1, hours) * 3_600_000;
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const count = await store().rateHit(`w:ai:${userId}`, windowStart, windowMs);
  return { ok: count <= limit, limit, used: Math.min(count, limit), remaining: Math.max(0, limit - count), resetsAt: windowStart + windowMs, windowHours: hours };
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
