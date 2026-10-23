import { NextResponse } from "next/server";
import { aiStatus, liteModel } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";
import { currentUser } from "@/lib/server/auth";
import { peekAllowance } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Provider status for the signed-in person. Everyone sees whether AI is on and
 * their own allowance; provider/model names and the shared budget are admin-only.
 */
export async function GET() {
  const s = aiStatus();
  const user = await currentUser();
  const isAdmin = user?.role === "admin";
  const allowance = user && s.configured ? await peekAllowance(user.id, env.aiUserQuota, env.aiUserWindowHours) : undefined;
  let usedToday = 0;
  if (isAdmin && s.configured && env.aiGlobalPerDay > 0) {
    try {
      const day = 86_400_000;
      const start = Date.now() - (Date.now() % day);
      const snap = await store().snapshot();
      usedToday = snap.audit.filter((a) => a.action.startsWith("ai.") && a.at >= start && !(a.detail ?? "").startsWith("cache hit")).length;
    } catch { /* status must never fail */ }
  }
  return NextResponse.json({
    configured: s.configured,
    hint: s.configured ? undefined : s.hint,
    allowance,
    ...(isAdmin ? { admin: { provider: s.provider, model: s.model, liteModel: s.configured ? liteModel() : undefined, budget: { perMinute: env.aiGlobalPerMin, perDay: env.aiGlobalPerDay, usedToday, cacheDays: env.aiCacheDays } } } : {}),
  });
}
