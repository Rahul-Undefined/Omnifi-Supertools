import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tools, getTool, relatedTools } from "@/tools/registry";
import { categoryById } from "@/tools/categories";
import { ToolRunner } from "@/components/tools/ToolRunner";
import { CustomTool } from "@/components/custom";
import { ToolGrid } from "@/components/tools/ToolGrid";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Workflow } from "lucide-react";

export function generateStaticParams() {
  return tools.map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = getTool(id);
  return { title: t?.name ?? "Tool", description: t?.description };
}

export default async function ToolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const { q } = await searchParams;
  const tool = getTool(id);
  if (!tool) notFound();
  const category = categoryById[tool.category];
  const related = relatedTools(tool);
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader
        title={tool.name}
        description={tool.description}
        icon={tool.icon}
        crumbs={[{ href: "/tools", label: "Tools" }, { href: `/tools/${category.id}`, label: category.name }]}
        actions={
          <>
            {tool.chainable && tool.status === "ready" && (
              <Link href={`/workflows?add=${tool.id}`}><Button variant="secondary" size="sm"><Workflow className="h-4 w-4" /> Use in workflow</Button></Link>
            )}
            <FavoriteButton toolId={tool.id} />
          </>
        }
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {tool.status === "ready" && tool.kind === "custom" ? (
            <CustomTool processor={tool.processor} />
          ) : tool.status === "ready" ? (
            <ToolRunner tool={tool} initialText={q ?? ""} />
          ) : (
            <div className="rounded-control border border-warning/40 bg-warning-soft p-8 text-center">
              <Badge tone="warning">Coming soon</Badge>
              <h2 className="mt-3 text-xl font-semibold text-foreground">This tool is not available yet</h2>
              <p className="mx-auto mt-2 max-w-md text-body">It needs a server-side engine that is not part of this deployment. It is listed here so you know it is planned. Nothing runs when you open it.</p>
              <Link href={`/tools/${category.id}`} className="mt-5 inline-block"><Button variant="secondary">Browse {category.name} tools</Button></Link>
            </div>
          )}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-control border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold text-foreground">About this tool</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Runs" v={tool.runtime === "browser" ? "In your browser" : "On the OmniFi server"} />
              <Row k="Accepts" v={tool.input.length ? tool.input.map((i) => i.replace("/*", "").replace("image/", "")).join(", ") : tool.kind === "custom" ? "Interactive" : "Text / values"} />
              <Row k="Produces" v={tool.output.length ? tool.output.join(", ") : "On-screen results"} />
              <Row k="Batch" v={tool.multiple ? "Yes" : "Single"} />
            </dl>
          </div>
          {related.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">Related tools</h3>
              <ToolGrid tools={related} compact className="sm:grid-cols-1 lg:grid-cols-1" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right text-foreground capitalize">{v}</dd>
    </div>
  );
}
