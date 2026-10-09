"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import { usePrefs } from "@/store/prefs";
import { getTool } from "@/tools/registry";
import { ToolGrid } from "@/components/tools/ToolGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

export default function FavoritesPage() {
  const favorites = usePrefs((s) => s.favorites);
  const tools = favorites.map((id) => getTool(id)).filter(Boolean) as NonNullable<ReturnType<typeof getTool>>[];
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="Favorites" description="Tools you have starred. They also appear on the home page and in the command palette." icon="Star" />
      {tools.length ? <ToolGrid tools={tools} /> : (
        <EmptyState icon={<Star className="h-6 w-6" />} title="No favorites yet" description="Open any tool and press F, or click the star on a tool card.">
          <Link href="/tools" className="text-sm font-medium text-accent hover:underline">Browse tools</Link>
        </EmptyState>
      )}
    </div>
  );
}
