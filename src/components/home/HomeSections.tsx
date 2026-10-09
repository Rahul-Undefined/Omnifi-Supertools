"use client";
import Link from "next/link";
import { ArrowRight, Star, Clock } from "lucide-react";
import { getTool, readyTools, toolsInCategory, categories } from "@/tools/registry";
import { usePrefs } from "@/store/prefs";
import { ToolGrid } from "@/components/tools/ToolGrid";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { Card } from "@/components/ui/Card";

/** Sensible defaults until a user has their own usage history. */
const DEFAULT_POPULAR = ["merge-pdf", "compress-pdf", "pdf-to-jpg", "jpg-to-pdf", "compress-image", "csv-to-excel", "json-formatter", "qr-generator"];

export function PopularTools() {
  const usage = usePrefs((s) => s.usage);
  const ranked = Object.entries(usage).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const ids = [...new Set([...ranked, ...DEFAULT_POPULAR])].slice(0, 8);
  const tools = ids.map((id) => getTool(id)).filter((t) => t && t.status === "ready") as NonNullable<ReturnType<typeof getTool>>[];
  return (
    <Section title="Popular tools" href="/tools" linkLabel="All tools">
      <ToolGrid tools={tools} compact />
    </Section>
  );
}

export function FavoriteTools() {
  const favorites = usePrefs((s) => s.favorites);
  const tools = favorites.map((id) => getTool(id)).filter(Boolean) as NonNullable<ReturnType<typeof getTool>>[];
  if (!tools.length) return null;
  return (
    <Section title="Your favorites" href="/favorites" linkLabel="Manage" icon={<Star className="h-4 w-4 text-accent" fill="currentColor" />}>
      <ToolGrid tools={tools.slice(0, 8)} compact />
    </Section>
  );
}

export function RecentTools() {
  const recent = usePrefs((s) => s.recent);
  const tools = recent.map((r) => getTool(r.id)).filter(Boolean).slice(0, 4) as NonNullable<ReturnType<typeof getTool>>[];
  if (!tools.length) return null;
  return (
    <Section title="Recently used" href="/recent" linkLabel="See all" icon={<Clock className="h-4 w-4 text-muted" />}>
      <ToolGrid tools={tools} compact />
    </Section>
  );
}

export function CategoryCards() {
  return (
    <Section title="Explore tools" href="/tools" linkLabel="Browse everything">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => {
          const all = toolsInCategory(c.id);
          const ready = all.filter((t) => t.status === "ready");
          return (
            <Link key={c.id} href={`/tools/${c.id}`} className="group">
              <Card interactive className="flex h-full flex-col p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-control-sm bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground"><ToolIcon name={c.icon} className="h-6 w-6" /></span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{c.name}</h3>
                <p className="mt-1 flex-1 text-sm text-muted">{c.description}</p>
                <p className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted"><span className="font-medium text-accent">{ready.length}</span> ready{all.length > ready.length ? ` · ${all.length - ready.length} planned` : ""}</span>
                  <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

export function Stats() {
  const ready = readyTools().length;
  const browser = readyTools().filter((t) => t.runtime === "browser").length;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat n={ready} label="tools ready to use" />
      <Stat n={browser} label="run fully in your browser" />
      <Stat n={categories.length} label="categories" />
      <Stat n={0} label="files stored on our servers" />
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-control border border-border bg-surface p-5">
      <p className="font-mono text-3xl text-accent">{n}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

function Section({ title, href, linkLabel, icon, children }: { title: string; href: string; linkLabel: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">{icon}{title}<span className="brand-dot">.</span></h2>
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">{linkLabel} <ArrowRight className="h-4 w-4" /></Link>
      </div>
      {children}
    </section>
  );
}
