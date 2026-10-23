import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { aiStatus, liteModel } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { registryStats, getTool } from "@/tools/registry";
import { handleError } from "@/lib/server/api";
import { stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const snap = await store().snapshot();
    const now = Date.now();
    const day = now - 86400000;
    const week = now - 7 * 86400000;
    const usage = snap.usage;
    const byTool = new Map<string, { runs: number; failed: number; ms: number }>();
    for (const u of usage) {
      const t = byTool.get(u.tool) ?? { runs: 0, failed: 0, ms: 0 };
      t.runs++;
      if (!u.ok && !u.cancelled) t.failed++;
      t.ms += u.ms;
      byTool.set(u.tool, t);
    }
    const popular = [...byTool.entries()].map(([id, v]) => ({ id, name: getTool(id)?.name ?? id, runs: v.runs, failed: v.failed, avgMs: Math.round(v.ms / Math.max(1, v.runs)) })).sort((a, b) => b.runs - a.runs).slice(0, 15);
    const failedJobs = usage.filter((u) => !u.ok && !u.cancelled).slice(-25).reverse().map((u) => ({ at: u.at, tool: getTool(u.tool)?.name ?? u.tool, ms: u.ms }));
    const totalMs = usage.reduce((a, u) => a + u.ms, 0);

    let storageBytes = 0;
    if (!env.databaseUrl) {
      try {
        // Only the JSON store file is measured; never walk arbitrary paths.
        const file = path.join(/* turbopackIgnore: true */ process.cwd(), env.dataDir, "store.json");
        storageBytes = (await stat(file)).size;
      } catch { /* no data file yet */ }
    }

    const aiRows = snap.audit.filter((a) => a.action.startsWith("ai."));
    const isCache = (a: { detail?: string }) => (a.detail ?? "").startsWith("cache hit");
    const byUser = new Map<string, { total: number; today: number; week: number; cached: number }>();
    const byTask = new Map<string, number>();
    for (const a of aiRows) {
      const u = byUser.get(a.actor) ?? { total: 0, today: 0, week: 0, cached: 0 };
      u.total++; if (a.at > day) u.today++; if (a.at > week) u.week++; if (isCache(a)) u.cached++;
      byUser.set(a.actor, u);
      byTask.set(a.action.slice(3), (byTask.get(a.action.slice(3)) ?? 0) + 1);
    }
    const key = env.aiProvider === "gemini" ? env.geminiKey : env.aiProvider === "anthropic" ? env.anthropicKey : env.openaiKey;
    const ai = {
      ...aiStatus(),
      liteModel: aiStatus().configured ? liteModel() : undefined,
      keyFingerprint: key ? `…${key.slice(-4)} (${key.length} chars)` : "not set",
      limits: { perUser: env.aiUserQuota, windowHours: env.aiUserWindowHours, globalPerMin: env.aiGlobalPerMin, globalPerDay: env.aiGlobalPerDay, cacheDays: env.aiCacheDays, maxInputChars: env.aiMaxInputChars },
      totals: { all: aiRows.length, today: aiRows.filter((a) => a.at > day).length, week: aiRows.filter((a) => a.at > week).length, cached: aiRows.filter(isCache).length, providerCallsToday: aiRows.filter((a) => a.at > day && !isCache(a)).length },
      byUser: [...byUser.entries()].map(([user, v]) => ({ user, ...v })).sort((a, b) => b.week - a.week).slice(0, 50),
      byTask: [...byTask.entries()].map(([task, n]) => ({ task, n })).sort((a, b) => b.n - a.n),
      recent: aiRows.slice(-30).reverse().map((a) => ({ at: a.at, user: a.actor, task: a.action.slice(3), detail: a.detail ?? "" })),
    };
    return NextResponse.json({
      ai,
      users: { total: Object.keys(snap.users).length, activeToday: Object.values(snap.users).filter((t) => t > day).length, activeWeek: Object.values(snap.users).filter((t) => t > week).length },
      usage: { total: usage.length, today: usage.filter((u) => u.at > day).length, week: usage.filter((u) => u.at > week).length, failed: usage.filter((u) => !u.ok && !u.cancelled).length, cancelled: usage.filter((u) => u.cancelled).length, avgMs: Math.round(totalMs / Math.max(1, usage.length)), p95Ms: percentile(usage.map((u) => u.ms), 0.95) },
      popular,
      failedJobs,
      audit: snap.audit.slice(-200).reverse(),
      feedback: await store().listFeedback(100),
      system: { uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), storage: store().kind, storageBytes, ai: aiStatus(), authMode: env.authMode, trustProxyHeaders: env.trustProxyHeaders, retentionDays: { usage: env.retentionUsageDays, audit: env.retentionAuditDays, feedback: env.retentionFeedbackDays, prefs: env.retentionPrefsDays }, queue: "inline (browser-side processing; no server queue configured)" },
      registry: registryStats(),
      featureFlags: { ai: aiStatus().configured, serverConverters: false, mediaDownloader: false, postgres: Boolean(env.databaseUrl) },
    });
  } catch (e) {
    return handleError(e);
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
