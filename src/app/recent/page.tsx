"use client";
import Link from "next/link";
import { Clock } from "lucide-react";
import { usePrefs } from "@/store/prefs";
import { getTool } from "@/tools/registry";
import { ToolGrid } from "@/components/tools/ToolGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

export default function RecentPage() {
  const recent = usePrefs((s) => s.recent);
  const tools = recent.map((r) => getTool(r.id)).filter(Boolean) as NonNullable<ReturnType<typeof getTool>>[];
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="Recently used" description="Tracked in this browser only. Nothing about your files is recorded." icon="Clock" />
      {tools.length ? <ToolGrid tools={tools} /> : (
        <EmptyState icon={<Clock className="h-6 w-6" />} title="Nothing yet" description="Tools you open will show up here.">
          <Link href="/tools" className="text-sm font-medium text-accent hover:underline">Browse tools</Link>
        </EmptyState>
      )}
    </div>
  );
}
