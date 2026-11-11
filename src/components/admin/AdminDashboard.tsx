"use client";
import { Fragment, useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { formatBytes } from "@/lib/utils";

interface AiStats {
  configured: boolean; provider?: string; model?: string; liteModel?: string; hint?: string; keyFingerprint: string;
  limits: { perUser: number; windowHours: number; globalPerMin: number; globalPerDay: number; cacheDays: number; maxInputChars: number };
  totals: { all: number; today: number; week: number; cached: number; providerCallsToday: number };
  byUser: { user: string; total: number; today: number; week: number; cached: number }[];
  byTask: { task: string; n: number }[];
  tokens?: { today: number; week: number; perModel: { model: string; today: number; week: number; callsToday: number }[] };
  providerLimits?: { model: string; at: number; requestsLimit?: number; requestsRemaining?: number; requestsReset?: string; tokensLimit?: number; tokensRemaining?: number; tokensReset?: string }[];
  recent: { at: number; user: string; task: string; detail: string }[];
}

interface Person { user: string; runs: number; today: number; week: number; aiRuns: number; toolsUsed: number; aiToolsUsed: number; lastActive: number; tools: { id: string; name: string; runs: number; ai: boolean }[] }

interface Stats {
  ai?: AiStats;
  people?: Person[];
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

      <section>
        <H2>People &amp; tools</H2>
        {s.system.storage !== "postgres" && (
          <p className="mb-4 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">Usage data is stored in a file on the server, which is wiped on every deploy. Set DATABASE_URL (a free Neon Postgres works) to keep history, favourites and AI allowances across updates. See docs/DEPLOYMENT.md.</p>
        )}
        <PeopleTable people={s.people ?? []} />
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

      {s.ai && (
        <section>
          <H2>AI usage</H2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Provider" value={s.ai.configured ? `${s.ai.provider} · ${s.ai.model}` : "Not configured"} small tone={s.ai.configured ? "success" : "warning"} />
            <Kpi label="Quick-task model" value={s.ai.liteModel ?? "—"} small />
            <Kpi label="API key" value={s.ai.keyFingerprint} small />
            <Kpi label="Per person" value={`${s.ai.limits.perUser} / ${s.ai.limits.windowHours} h`} />
            <Kpi label="Requests today" value={s.ai.totals.today} />
            <Kpi label="Provider calls today" value={`${s.ai.totals.providerCallsToday} / ${s.ai.limits.globalPerDay}`} tone={s.ai.totals.providerCallsToday > s.ai.limits.globalPerDay * 0.85 ? "warning" : undefined} />
            <Kpi label="This week" value={s.ai.totals.week} />
            <Kpi label="All time (cache hits)" value={`${s.ai.totals.all} (${s.ai.totals.cached})`} small />
          </div>
          <p className="mt-2 text-xs text-muted">Shared pacing {s.ai.limits.globalPerMin}/min · answer cache {s.ai.limits.cacheDays} days · max input {s.ai.limits.maxInputChars.toLocaleString()} chars. Counts come from the audit log (retention applies).</p>
          {s.ai.tokens && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Provider budget (live)</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Tokens used today" value={s.ai.tokens.today} />
                <Kpi label="Tokens this week" value={s.ai.tokens.week} />
                {s.ai.providerLimits?.slice(0, 2).map((l) => (
                  <Kpi key={l.model} small label={`${l.model}: left`} value={`${l.requestsRemaining?.toLocaleString() ?? "?"} / ${l.requestsLimit?.toLocaleString() ?? "?"} requests · ${l.tokensRemaining?.toLocaleString() ?? "?"} / ${l.tokensLimit?.toLocaleString() ?? "?"} tokens/min`} tone={l.requestsRemaining != null && l.requestsLimit != null && l.requestsRemaining < l.requestsLimit * 0.15 ? "warning" : "success"} />
                ))}
              </div>
              {s.ai.providerLimits?.length ? (
                <Table head={["Model", "Requests left (window)", "Resets in", "Tokens left (per minute)", "Resets in", "Tokens today", "Calls today", "Seen"]} rows={s.ai.providerLimits.map((l) => { const t = s.ai!.tokens!.perModel.find((m) => m.model === l.model); return [l.model, `${l.requestsRemaining?.toLocaleString() ?? "?"} of ${l.requestsLimit?.toLocaleString() ?? "?"}`, l.requestsReset ?? "–", `${l.tokensRemaining?.toLocaleString() ?? "?"} of ${l.tokensLimit?.toLocaleString() ?? "?"}`, l.tokensReset ?? "–", t?.today ?? 0, t?.callsToday ?? 0, new Date(l.at).toLocaleTimeString()]; })} empty="" />
              ) : (
                <p className="mt-2 text-xs text-muted">Provider limits appear here after the first AI call since the server started (read from the provider&apos;s rate-limit headers). Groq: requests are per day, tokens are per minute, per model.</p>
              )}
              {s.ai.tokens.perModel.length > 0 && !s.ai.providerLimits?.length && (
                <Table head={["Model", "Tokens today", "Tokens this week", "Calls today"]} rows={s.ai.tokens.perModel.map((m) => [m.model, m.today, m.week, m.callsToday])} empty="" />
              )}
            </div>
          )}
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">By person</h3>
              <Table head={["Person", "Today", "7 days", "All time", "Cache hits"]} rows={s.ai.byUser.map((u) => [u.user, u.today, u.week, u.total, u.cached])} empty="No AI requests yet." />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">By tool</h3>
              <Table head={["Task", "Requests"]} rows={s.ai.byTask.map((t) => [t.task, t.n])} empty="No AI requests yet." />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Recent AI requests</h3>
            <Table head={["When", "Person", "Task", "Detail"]} rows={s.ai.recent.map((r) => [new Date(r.at).toLocaleString(), r.user, r.task, r.detail])} empty="No AI requests yet." />
          </div>
        </section>
      )}

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

function PeopleTable({ people }: { people: Person[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!people.length) return <p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">No signed-in usage recorded yet (last 30 days).</p>;
  return (
    <div className="overflow-auto rounded-control border border-border">
      <table className="w-full text-sm">
        <thead className="bg-navy-800 text-white"><tr>{["Person", "Runs (30 d)", "This week", "Today", "Tools used", "AI runs", "AI tools", "Last active", "Most used"].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {people.map((p) => (
            <Fragment key={p.user}>
              <tr className="odd:bg-surface even:bg-surface-2 cursor-pointer hover:bg-accent-soft/40" onClick={() => setOpen(open === p.user ? null : p.user)} title="Click to see every tool this person used">
                <td className="px-3 py-2 text-foreground font-medium whitespace-nowrap">{open === p.user ? "▾" : "▸"} {p.user}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.runs.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.week.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.today.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.toolsUsed}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.aiRuns.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{p.aiToolsUsed}</td>
                <td className="px-3 py-2 text-body whitespace-nowrap">{new Date(p.lastActive).toLocaleString()}</td>
                <td className="px-3 py-2 text-body">{p.tools.slice(0, 3).map((t) => t.name).join(", ")}{p.tools.length > 3 ? ` +${p.tools.length - 3}` : ""}</td>
              </tr>
              {open === p.user && (
                <tr className="bg-surface-2">
                  <td colSpan={9} className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {p.tools.map((t) => (
                        <span key={t.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${t.ai ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface text-body"}`}>
                          {t.ai && <Sparkles className="h-3 w-3" />}{t.name}<span className="font-mono tabular-nums text-muted">×{t.runs}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
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
