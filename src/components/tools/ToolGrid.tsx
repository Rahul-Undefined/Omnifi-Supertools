import type { ToolDefinition } from "@/types/tool";
import { ToolCard } from "./ToolCard";
import { cn } from "@/lib/utils";

export function ToolGrid({ tools, compact, className }: { tools: ToolDefinition[]; compact?: boolean; className?: string }) {
  if (!tools.length) return null;
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", compact ? "lg:grid-cols-4" : "lg:grid-cols-3", className)}>
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} compact={compact} />
      ))}
    </div>
  );
}

/** Ready tools first, then a clearly separated "coming soon" block. */
export function ToolGridSplit({ tools }: { tools: ToolDefinition[] }) {
  const ready = tools.filter((t) => t.status === "ready");
  const soon = tools.filter((t) => t.status !== "ready");
  return (
    <div className="space-y-10">
      <ToolGrid tools={ready} />
      {soon.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Coming soon</h3>
          <p className="mb-4 text-sm text-muted">These need server-side engines (LibreOffice, headless Chrome) that are not part of this build. They are listed so you know what is planned; they do not run.</p>
          <ToolGrid tools={soon} compact />
        </section>
      )}
    </div>
  );
}
