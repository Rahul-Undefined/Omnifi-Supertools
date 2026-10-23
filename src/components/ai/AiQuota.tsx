"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Sparkles, Gauge } from "lucide-react";

export interface Allowance { limit: number; used: number; remaining: number; resetsAt: number; windowHours: number }
export interface AiStatus { configured: boolean; hint?: string; allowance?: Allowance; admin?: { provider?: string; model?: string; liteModel?: string; budget?: { perMinute: number; perDay: number; usedToday: number; cacheDays: number } } }

/* Tiny cross-component store so a run updates the widget everywhere without refetching. */
let current: AiStatus | null = null;
const listeners = new Set<() => void>();
export function setAiStatus(s: AiStatus) { current = s; listeners.forEach((l) => l()); }
export function setAllowance(a: Allowance) { if (current) setAiStatus({ ...current, allowance: a }); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => current;

export function useAiStatus(): AiStatus | null {
  const s = useSyncExternalStore(subscribe, get, () => null);
  useEffect(() => {
    if (current) return;
    fetch("/api/ai/status").then((r) => r.json()).then(setAiStatus).catch(() => setAiStatus({ configured: false }));
  }, []);
  return s;
}

export function formatUntil(ts: number, now = Date.now()): string {
  const mins = Math.max(0, Math.ceil((ts - now) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12 of 15 AI requests left · resets in 2 h 10 min" */
export function AiQuotaWidget({ compact = false }: { compact?: boolean }) {
  const s = useAiStatus();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);
  const a = s?.allowance;
  if (!s || !s.configured || !a || a.limit <= 0) return null;
  const pct = Math.round((a.remaining / a.limit) * 100);
  const tone = a.remaining === 0 ? "text-error" : a.remaining <= 3 ? "text-warning" : "text-success";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${compact ? "text-xs" : "text-sm"} text-body`} title={`${a.limit} AI requests per ${a.windowHours} hours per person. Repeating an identical request does not count.`}>
      <Sparkles className={`h-4 w-4 ${tone}`} />
      <span><span className={`font-semibold ${tone}`}>{a.remaining}</span> of {a.limit} AI requests left</span>
      <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full ${a.remaining === 0 ? "bg-error" : a.remaining <= 3 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} /></span>
      <span className="text-muted">{a.remaining === 0 ? "frees up in" : "resets in"} {formatUntil(a.resetsAt)}</span>
    </div>
  );
}

/** Banner for the AI page: connection state + personal allowance; admins also see provider details and the shared budget. */
export function AiStatusBanner() {
  const s = useAiStatus();
  if (!s) return <div className="mb-8 h-14 rounded-control bg-surface-2 animate-pulse" />;
  if (!s.configured) return (
    <div className="mb-8 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
      <p className="font-medium">AI tools are not available yet</p>
      <p className="mt-1 text-body">{s.hint ?? "An administrator needs to connect an AI provider on the server."}</p>
    </div>
  );
  const b = s.admin?.budget;
  return (
    <div className="mb-8 rounded-control border border-success/40 bg-success-soft px-4 py-3 text-sm text-foreground space-y-2">
      <p className="font-medium">AI tools are on. Each person gets {s.allowance?.limit ?? 15} requests per {s.allowance?.windowHours ?? 3} hours; repeating an identical request is free.</p>
      <AiQuotaWidget />
      {s.admin && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-success/30 pt-2 text-xs text-muted">
          <Gauge className="h-3.5 w-3.5" /> <span>Admin view:</span>
          <span>{s.admin.provider} · <span className="font-mono">{s.admin.model}</span>{s.admin.liteModel && s.admin.liteModel !== s.admin.model ? <> · quick tasks <span className="font-mono">{s.admin.liteModel}</span></> : null}</span>
          {b && b.perDay > 0 && <span>· shared today {b.usedToday} / {b.perDay} (max {b.perMinute}/min, cache {b.cacheDays} d)</span>}
        </div>
      )}
    </div>
  );
}
