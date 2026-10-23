"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import type { ToolDefinition } from "@/types/tool";
import { Badge } from "@/components/ui/Card";
import { ToolIcon } from "./ToolIcon";
import { usePrefs } from "@/store/prefs";
import { cn } from "@/lib/utils";

export function ToolCard({ tool, compact }: { tool: ToolDefinition; compact?: boolean }) {
  const isFav = usePrefs((s) => s.favorites.includes(tool.id));
  const toggle = usePrefs((s) => s.toggleFavorite);
  const soon = tool.status !== "ready";
  return (
    <Link
      href={`/tool/${tool.id}`}
      className={cn(
        "group relative flex gap-4 rounded-control border border-border bg-surface shadow-card transition-[transform,box-shadow,border-color] duration-300 ease-brand hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card-hover",
        compact ? "p-4" : "p-5",
        soon && "opacity-80",
      )}
    >
      <span className={cn("flex shrink-0 items-center justify-center rounded-control-sm bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground", compact ? "h-10 w-10" : "h-12 w-12")}>
        <ToolIcon name={tool.icon} className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-foreground">{tool.name}</span>
          {soon && <Badge tone="warning">Coming soon</Badge>}
        </span>
        {!compact && <span className="mt-1 block text-sm text-muted line-clamp-2">{tool.description}</span>}
      </span>
      <button
        type="button"
        aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={isFav}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(tool.id); }}
        className={cn("absolute right-3 top-3 rounded-full p-1.5 transition-colors", isFav ? "text-accent" : "text-muted/40 opacity-0 group-hover:opacity-100 hover:text-accent focus-visible:opacity-100")}
      >
        <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} />
      </button>
    </Link>
  );
}
