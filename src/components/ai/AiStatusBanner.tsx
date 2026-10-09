"use client";
import { useEffect, useState } from "react";
import { Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";

export function AiStatusBanner() {
  const [s, setS] = useState<{ configured: boolean; provider?: string; model?: string; hint?: string } | null>(null);
  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then(setS).catch(() => setS({ configured: false }));
  }, []);
  if (!s) return <div className="mb-8 h-14 rounded-control bg-surface-2 animate-pulse" />;
  return s.configured ? (
    <p className="mb-8 flex items-center gap-2.5 rounded-control border border-success/40 bg-success-soft px-4 py-3 text-sm text-foreground">
      <CheckCircle2 className="h-4 w-4 text-success" /> AI provider connected: <span className="font-medium">{s.provider}</span> <span className="font-mono text-xs text-muted">{s.model}</span>
    </p>
  ) : (
    <div className="mb-8 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-warning" /> AI provider is not configured</p>
      <p className="mt-1 flex items-start gap-2 text-body"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> {s.hint ?? "Set AI_PROVIDER and an API key on the server to enable these tools. The tools below open, but they will not run until then."}</p>
    </div>
  );
}
