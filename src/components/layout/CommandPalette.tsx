"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Search, Clock, Star, ArrowRight } from "lucide-react";
import { searchTools } from "@/lib/search";
import { getTool, categories } from "@/tools/registry";
import { usePrefs } from "@/store/prefs";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Badge, Kbd } from "@/components/ui/Card";

const EVENT = "omnifi:palette";
export function openPalette() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const recent = usePrefs((s) => s.recent);
  const favorites = usePrefs((s) => s.favorites);

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const setOpenAndReset = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const hits = query ? searchTools(query, 10) : [];
  const recentTools = recent.slice(0, 5).map((r) => getTool(r.id)).filter(Boolean);
  const favTools = favorites.slice(0, 5).map((id) => getTool(id)).filter(Boolean);

  return (
    <Command.Dialog open={open} onOpenChange={setOpenAndReset} label="Search tools" shouldFilter={false} className="fixed inset-0 z-[60]" overlayClassName="fixed inset-0 bg-navy-900/50 backdrop-blur-sm" contentClassName="fixed left-1/2 top-[12vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-control border border-border bg-surface shadow-float overflow-hidden animate-fade-up">
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="h-4 w-4 text-muted shrink-0" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="What do you want to do?" className="h-14 flex-1 bg-transparent text-base text-foreground placeholder:text-muted/70 outline-none" autoFocus />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
        <Command.Empty className="px-4 py-10 text-center text-sm text-muted">No tools match “{query}”.</Command.Empty>
        {query ? (
          <Command.Group heading="Tools" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
            {hits.map((h) => (
              <Item key={h.tool.id} onSelect={() => go(`/tool/${h.tool.id}`)} icon={h.tool.icon} title={h.tool.name} subtitle={h.categoryName} comingSoon={h.tool.status !== "ready"} />
            ))}
          </Command.Group>
        ) : (
          <>
            {favTools.length > 0 && (
              <Command.Group heading="Favorites" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {favTools.map((t) => t && <Item key={t.id} onSelect={() => go(`/tool/${t.id}`)} icon={t.icon} title={t.name} subtitle="Favorite" trailing={<Star className="h-3.5 w-3.5 text-accent" />} />)}
              </Command.Group>
            )}
            {recentTools.length > 0 && (
              <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {recentTools.map((t) => t && <Item key={t.id} onSelect={() => go(`/tool/${t.id}`)} icon={t.icon} title={t.name} subtitle="Recently used" trailing={<Clock className="h-3.5 w-3.5 text-muted" />} />)}
              </Command.Group>
            )}
            <Command.Group heading="Browse" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
              {categories.map((c) => (
                <Item key={c.id} onSelect={() => go(`/tools/${c.id}`)} icon={c.icon} title={c.name} subtitle={c.description} trailing={<ArrowRight className="h-3.5 w-3.5 text-muted" />} />
              ))}
            </Command.Group>
          </>
        )}
      </Command.List>
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
      </div>
    </Command.Dialog>
  );
}

function Item({ onSelect, icon, title, subtitle, trailing, comingSoon }: { onSelect: () => void; icon?: string; title: string; subtitle?: string; trailing?: React.ReactNode; comingSoon?: boolean }) {
  return (
    <Command.Item value={title} onSelect={onSelect} className="flex cursor-pointer items-center gap-3 rounded-control-sm px-3 py-2.5 text-sm text-body aria-selected:bg-accent-soft aria-selected:text-foreground">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><ToolIcon name={icon} className="h-4 w-4" /></span>
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
      {comingSoon ? <Badge tone="warning">Coming soon</Badge> : trailing}
    </Command.Item>
  );
}
