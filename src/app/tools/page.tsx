import type { Metadata } from "next";
import Link from "next/link";
import { categories, toolsInCategory, tools } from "@/tools/registry";
import { searchTools } from "@/lib/search";
import { ToolGrid, ToolGridSplit } from "@/components/tools/ToolGrid";
import { ToolIcon } from "@/components/tools/ToolIcon";
import { SearchBox } from "@/components/home/SearchBox";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata: Metadata = { title: "Tools" };

export default async function ToolsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  if (query) {
    const hits = searchTools(query, 40).map((h) => h.tool);
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <PageHeader title={`Results for “${query}”`} description={`${hits.length} matching tool${hits.length === 1 ? "" : "s"}.`} />
        <div className="mb-8 max-w-2xl"><SearchBox /></div>
        {hits.length ? <ToolGridSplit tools={hits} /> : <p className="text-muted">Nothing matched. Try a different word, or <Link href="/tools" className="text-accent underline">browse all tools</Link>.</p>}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="All tools" description={`${tools.filter((t) => t.status === "ready").length} tools ready to use across ${categories.length} categories.`} />
      <div className="mb-8 max-w-2xl"><SearchBox /></div>
      <nav className="mb-10 flex flex-wrap gap-2" aria-label="Categories">
        {categories.map((c) => (
          <a key={c.id} href={`#${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-sm text-body hover:border-accent hover:text-accent transition-colors">
            <ToolIcon name={c.icon} className="h-3.5 w-3.5" /> {c.name}
          </a>
        ))}
      </nav>
      <div className="space-y-14">
        {categories.map((c) => {
          const list = toolsInCategory(c.id).filter((t) => t.status === "ready");
          return (
            <section key={c.id} id={c.id} className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between">
                <h2 className="flex items-center gap-2.5 text-xl font-semibold text-foreground"><ToolIcon name={c.icon} className="h-5 w-5 text-accent" /> {c.name}<span className="brand-dot">.</span></h2>
                <Link href={`/tools/${c.id}`} className="text-sm font-medium text-accent hover:underline">View category</Link>
              </div>
              <ToolGrid tools={list} compact />
            </section>
          );
        })}
      </div>
    </div>
  );
}
