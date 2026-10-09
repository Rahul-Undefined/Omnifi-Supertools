import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { aiStatus } from "@/lib/server/ai";
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

    return NextResponse.json({
      users: { total: Object.keys(snap.users).length, activeToday: Object.values(snap.users).filter((t) => t > day).length, activeWeek: Object.values(snap.users).filter((t) => t > week).length },
      usage: { total: usage.length, today: usage.filter((u) => u.at > day).length, week: usage.filter((u) => u.at > week).length, failed: usage.filter((u) => !u.ok && !u.cancelled).length, cancelled: usage.filter((u) => u.cancelled).length, avgMs: Math.round(totalMs / Math.max(1, usage.length)), p95Ms: percentile(usage.map((u) => u.ms), 0.95) },
      popular,
      failedJobs,
      audit: snap.audit.slice(-200).reverse(),
      system: { uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), node: process.version, storage: store().kind, storageBytes, ai: aiStatus(), authMode: env.authMode, queue: "inline (browser-side processing; no server queue configured)" },
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
