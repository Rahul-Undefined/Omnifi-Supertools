"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { formatBytes } from "@/lib/utils";

interface Stats {
  users: { total: number; activeToday: number; activeWeek: number };
  usage: { total: number; today: number; week: number; failed: number; cancelled: number; avgMs: number; p95Ms: number };
  popular: { id: string; name: string; runs: number; failed: number; avgMs: number }[];
  failedJobs: { at: number; tool: string; ms: number }[];
  audit: { at: number; actor: string; action: string; detail?: string }[];
  feedback?: { at: number; from: string; kind: string; tool: string; message: string }[];
  system: { uptimeSeconds: number; memoryMb: number; storage: string; storageBytes: number; ai: { configured: boolean; provider?: string; model?: string }; authMode: string; trustProxyHeaders?: boolean; retentionDays?: { usage: number; audit: number; feedback: number; prefs: number }; queue: string };
  registry: { total: number; ready: number; comingSoon: number; categories: number };
  featureFlags: Record<string, boolean>;
}

export function AdminDashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchStats = async (): Promise<Stats> => {
    const r = await fetch("/api/admin/stats", { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
    return r.json();
  };
  const load = () => {
    setBusy(true);
    fetchStats()
      .then((d) => { setS(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then((d) => { if (!cancelled) setS(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="rounded-control bg-error-soft px-4 py-3 text-sm">{error}</p>;
  if (!s) return <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-control bg-surface-2" />)}</div>;

  const fmtTime = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  const uptime = `${Math.floor(s.system.uptimeSeconds / 3600)}h ${Math.floor((s.system.uptimeSeconds % 3600) / 60)}m`;

  return (
    <div className="space-y-10">
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={load} loading={busy}><RefreshCw className="h-4 w-4" /> Refresh</Button></div>

      <section>
        <H2>Users</H2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi label="Total users seen" value={s.users.total} />
          <Kpi label="Active today" value={s.users.activeToday} />
          <Kpi label="Active this week" value={s.users.activeWeek} />
        </div>
      </section>

      <section>
        <H2>Tool usage</H2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Runs (all time)" value={s.usage.total} />
          <Kpi label="Runs today" value={s.usage.today} />
          <Kpi label="Runs this week" value={s.usage.week} />
          <Kpi label="Failed jobs" value={s.usage.failed} tone={s.usage.failed ? "error" : undefined} />
          <Kpi label="Avg processing" value={fmtTime(s.usage.avgMs)} />
          <Kpi label="p95 processing" value={fmtTime(s.usage.p95Ms)} />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <H2>Most popular tools</H2>
          <Table head={["Tool", "Runs", "Failed", "Avg time"]} rows={s.popular.map((p) => [p.name, p.runs, p.failed, fmtTime(p.avgMs)])} empty="No usage recorded yet." />
        </section>
        <section>
          <H2>Recent failed jobs</H2>
          <Table head={["When", "Tool", "Duration"]} rows={s.failedJobs.map((f) => [new Date(f.at).toLocaleString(), f.tool, fmtTime(f.ms)])} empty="No failures. Nice." />
        </section>
      </div>

      <section>
        <H2>System health</H2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Uptime" value={uptime} />
          <Kpi label="Memory (RSS)" value={`${s.system.memoryMb} MB`} />
          <Kpi label="Retention (audit days)" value={s.system.retentionDays?.audit ?? 0} />
          <Kpi label="Storage" value={`${s.system.storage} · ${formatBytes(s.system.storageBytes)}`} />
          <Kpi label="Queue" value={s.system.queue} small />
          <Kpi label="Auth mode" value={s.system.authMode} />
          <Kpi label="AI provider" value={s.system.ai.configured ? `${s.system.ai.provider} · ${s.system.ai.model}` : "Not configured"} small tone={s.system.ai.configured ? "success" : "warning"} />
          <Kpi label="Registry" value={`${s.registry.ready} ready / ${s.registry.comingSoon} planned`} small />
        </div>
      </section>

      <section>
        <H2>Feature flags</H2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(s.featureFlags).map(([k, v]) => <Badge key={k} tone={v ? "success" : "neutral"}>{k}: {v ? "on" : "off"}</Badge>)}
        </div>
        <p className="mt-2 text-xs text-muted">Flags reflect server configuration (environment variables). Change them in the deployment, not here.</p>
      </section>

      <section>
        <H2>Team feedback</H2>
        <Table head={["When", "From", "Type", "Tool", "Message"]} rows={(s.feedback ?? []).map((f) => [new Date(f.at).toLocaleString(), f.from, f.kind, f.tool, f.message])} empty="No feedback yet. Share the /feedback link with the team." />
      </section>

      <section>
        <H2>Audit log</H2>
        <Table head={["When", "Actor", "Action", "Detail"]} rows={s.audit.map((a) => [new Date(a.at).toLocaleString(), a.actor, a.action, a.detail ?? ""])} empty="No audit events yet." />
      </section>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-lg font-semibold text-foreground">{children}<span className="brand-dot">.</span></h2>;
}

function Kpi({ label, value, small, tone }: { label: string; value: number | string; small?: boolean; tone?: "error" | "success" | "warning" }) {
  const color = tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-accent";
  return (
    <div className="rounded-control border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-mono ${small ? "text-sm" : "text-2xl"} ${color} break-words`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return <p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-auto rounded-control border border-border">
      <table className="w-full text-sm">
        <thead className="bg-navy-800 text-white"><tr>{head.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="odd:bg-surface even:bg-surface-2">{r.map((c, j) => <td key={j} className={`px-3 py-2 text-body ${typeof c === "number" ? "text-right font-mono tabular-nums" : ""}`}>{typeof c === "number" ? c.toLocaleString() : c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
