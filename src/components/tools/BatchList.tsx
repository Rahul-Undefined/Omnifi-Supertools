"use client";
import { Check, X, Loader2, Clock, Ban } from "lucide-react";
import type { ProcessorOutput } from "@/types/processor";
import { cn } from "@/lib/utils";

export interface BatchItem {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  error?: string;
  output?: ProcessorOutput;
}

export function BatchList({ items }: { items: BatchItem[] }) {
  const counts = items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span className="font-medium text-success">{counts.done ?? 0}</span> succeeded</span>
        <span><span className="font-medium text-error">{counts.failed ?? 0}</span> failed</span>
        {counts.cancelled ? <span>{counts.cancelled} cancelled</span> : null}
        {counts.queued ? <span>{counts.queued} queued</span> : null}
      </div>
      <ul className="max-h-64 divide-y divide-border overflow-auto rounded-control-sm border border-border scrollbar-thin">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", i.status === "done" && "bg-success text-navy-800", i.status === "failed" && "bg-error text-white", i.status === "running" && "text-accent", (i.status === "queued" || i.status === "cancelled") && "text-muted")}>
              {i.status === "done" && <Check className="h-3 w-3" strokeWidth={3} />}
              {i.status === "failed" && <X className="h-3 w-3" strokeWidth={3} />}
              {i.status === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
              {i.status === "queued" && <Clock className="h-4 w-4" />}
              {i.status === "cancelled" && <Ban className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground">{i.name}</span>
            {i.status === "running" && <span className="w-24 h-1.5 rounded-full bg-surface-3 overflow-hidden"><span className="block h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(i.progress * 100)}%` }} /></span>}
            {i.error && <span className="truncate text-xs text-error max-w-[40%]">{i.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
