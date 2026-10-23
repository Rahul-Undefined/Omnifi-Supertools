import { NextResponse } from "next/server";
import { aiStatus, liteModel } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Provider status plus today's shared usage so the team can see the free-tier budget. */
export async function GET() {
  const s = aiStatus();
  let usedToday = 0;
  try {
    if (s.configured && env.aiGlobalPerDay > 0) {
      const day = 86_400_000;
      const start = Date.now() - (Date.now() % day);
      // Peek at the counter without incrementing: increment then subtract is not possible, so read via a probe key? Simpler: count today's audit rows.
      const snap = await store().snapshot();
      usedToday = snap.audit.filter((a) => a.action.startsWith("ai.") && a.at >= start && !(a.detail ?? "").startsWith("cache hit")).length;
    }
  } catch { /* status must never fail */ }
  return NextResponse.json({ ...s, liteModel: s.configured ? liteModel() : undefined, budget: { perMinute: env.aiGlobalPerMin, perDay: env.aiGlobalPerDay, usedToday, cacheDays: env.aiCacheDays } });
}
