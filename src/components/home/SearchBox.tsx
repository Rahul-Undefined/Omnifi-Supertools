"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { searchTools, type SearchHit } from "@/lib/search";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Badge } from "@/components/ui/Card";

export function SearchBox({ large, autoFocus, className }: { large?: boolean; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const hits = useMemo<SearchHit[]>(() => searchTools(q, 8), [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (hit?: SearchHit) => {
    if (hit) router.push(`/tool/${hit.tool.id}`);
    else if (q.trim()) router.push(`/tools?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div className={cn("flex items-center gap-3 rounded-control border bg-white text-navy-800 shadow-float transition-[box-shadow,border-color] duration-300", large ? "h-16 px-5" : "h-12 px-4", open && hits.length ? "border-accent" : "border-transparent")}>
        <Search className={cn("shrink-0 text-muted", large ? "h-6 w-6" : "h-5 w-5")} />
        <input
          data-global-search
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={site.searchPlaceholder}
          className={cn("flex-1 bg-transparent outline-none focus:outline-none focus-visible:outline-none ring-0 shadow-none placeholder:text-muted/70", large ? "text-lg" : "text-base")}
          aria-label="Search tools"
          aria-autocomplete="list"
          aria-expanded={open && hits.length > 0}
          role="combobox"
          aria-controls="search-results"
        />
        <button type="button" onClick={() => go(hits[active])} className={cn("shrink-0 inline-flex items-center justify-center rounded-control-sm bg-accent text-white hover:bg-accent-hover transition-colors", large ? "h-11 w-11" : "h-9 w-9")} aria-label="Search">
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
      {open && q && (
        <ul id="search-results" role="listbox" className="absolute left-0 right-0 z-30 mt-2 max-h-96 overflow-auto rounded-control border border-border bg-surface p-1.5 shadow-float animate-fade-up scrollbar-thin">
          {hits.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No tools match “{q}”.</li>}
          {hits.map((h, i) => (
            <li key={h.tool.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("flex w-full items-center gap-3 rounded-control-sm px-3 py-2.5 text-left text-sm", i === active ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><ToolIcon name={h.tool.icon} className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{h.tool.name}</span>
                  <span className="block truncate text-xs text-muted">{h.categoryName} · {h.tool.description}</span>
                </span>
                {h.tool.status !== "ready" && <Badge tone="warning">Coming soon</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchExample({ text }: { text: string }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => { const hit = searchTools(text, 1)[0]; router.push(hit ? `/tool/${hit.tool.id}` : `/tools?q=${encodeURIComponent(text)}`); }} className="rounded-full border border-[rgba(139,145,227,0.34)] px-3.5 py-1.5 text-sm text-[#B6BAEC] transition-colors hover:border-lavender hover:text-paper">
      {text}
    </button>
  );
};
