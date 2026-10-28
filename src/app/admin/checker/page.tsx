import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, adminOpen } from "@/lib/server/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { ToolChecker } from "@/components/admin/ToolChecker";

export const metadata: Metadata = { title: "Tool checker" };
export const dynamic = "force-dynamic";

export default async function CheckerPage() {
  const user = await currentUser();
  const open = adminOpen();
  if (!user && !open) redirect("/login?next=/admin/checker");
  if (user && user.role !== "admin" && !open) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Admin access required<span className="brand-dot">.</span></h1>
        <p className="mt-2 text-body">You are signed in as {user.email}, which is not an administrator account.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <PageHeader title="Tool checker" description="Runs every tool with random, freshly generated input in this browser and reports which ones work. For administrators." icon="ClipboardCheck" />
      <ToolChecker />
    </div>
  );
}
