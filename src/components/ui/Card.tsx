import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-control border border-border bg-surface shadow-card",
        interactive && "transition-[transform,box-shadow,border-color] duration-300 ease-brand hover:-translate-y-0.5 hover:shadow-card-hover hover:border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "error" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-border",
    accent: "bg-accent-soft text-accent border-transparent",
    success: "bg-success-soft text-success border-transparent",
    warning: "bg-warning-soft text-warning border-transparent",
    error: "bg-error-soft text-error border-transparent",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
