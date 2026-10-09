import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categories, toolsInCategory } from "@/tools/registry";
import { categoryById } from "@/tools/categories";
import type { ToolCategoryId } from "@/types/tool";
import { ToolGridSplit } from "@/components/tools/ToolGrid";
import { PageHeader } from "@/components/layout/PageHeader";

export function generateStaticParams() {
  return categories.map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const c = categoryById[category as ToolCategoryId];
  return { title: c ? c.name : "Category" };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const c = categoryById[category as ToolCategoryId];
  if (!c) notFound();
  const list = toolsInCategory(c.id);
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title={c.name} description={c.description} icon={c.icon} crumbs={[{ href: "/tools", label: "Tools" }]} />
      <ToolGridSplit tools={list} />
    </div>
  );
}
