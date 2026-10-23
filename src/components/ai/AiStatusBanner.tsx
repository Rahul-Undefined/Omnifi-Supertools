"use client";
import { useEffect, useState } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, Gauge } from "lucide-react";

interface Status { configured: boolean; provider?: string; model?: string; liteModel?: string; hint?: string; budget?: { perMinute: number; perDay: number; usedToday: number; cacheDays: number } }

export function AiStatusBanner() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then(setS).catch(() => setS({ configured: false }));
  }, []);
  if (!s) return <div className="mb-8 h-14 rounded-control bg-surface-2 animate-pulse" />;
  if (!s.configured) return (
    <div className="mb-8 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-warning" /> AI provider is not configured</p>
      <p className="mt-1 flex items-start gap-2 text-body"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> {s.hint ?? "Set AI_PROVIDER and an API key on the server to enable these tools. The tools below open, but they will not run until then."}</p>
    </div>
  );
  const b = s.budget;
  const pct = b && b.perDay > 0 ? Math.min(100, Math.round((b.usedToday / b.perDay) * 100)) : 0;
  return (
    <div className="mb-8 rounded-control border border-success/40 bg-success-soft px-4 py-3 text-sm text-foreground">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <CheckCircle2 className="h-4 w-4 text-success" /> AI provider connected: <span className="font-medium">{s.provider}</span>
        <span className="font-mono text-xs text-muted">{s.model}</span>
        {s.liteModel && s.liteModel !== s.model && <span className="font-mono text-xs text-muted">· quick tasks: {s.liteModel}</span>}
      </p>
      {b && b.perDay > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-body">
          <Gauge className="h-4 w-4 text-muted" />
          <span>Shared free-tier budget today: <span className="font-medium text-foreground">{b.usedToday} / {b.perDay}</span> requests</span>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full ${pct > 85 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} /></span>
          <span className="text-muted">Repeated requests are served from a {b.cacheDays}-day cache and do not count.</span>
        </div>
      )}
    </div>
  );
}
