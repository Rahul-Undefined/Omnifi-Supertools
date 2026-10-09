import { cn } from "@/lib/utils";

export function ProgressBar({ value, label, className, indeterminate }: { value: number; label?: string; className?: string; indeterminate?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={cn("space-y-2", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-body truncate">{label ?? "Processing"}</span>
        <span className="font-mono text-xs text-accent tabular-nums">{indeterminate ? "" : `${pct}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("relative h-full rounded-full bg-accent transition-[width] duration-300 ease-out", indeterminate && "w-1/3 animate-pulse")} style={indeterminate ? undefined : { width: `${pct}%` }}>
          <span className="absolute inset-0 animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
