import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, adminOpen } from "@/lib/server/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { UsersPanel } from "@/components/admin/UsersPanel";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  const open = adminOpen();
  if (!user && !open) redirect("/login?next=/admin");
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
      <PageHeader title="Omnifi SuperTools Admin" description="Usage, health, team feedback and configuration. No file contents are ever recorded." icon="ShieldCheck" />
      {open && <p className="mb-6 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm text-body">Open mode: no accounts are configured, so this page is visible to everyone on the network. Set ADMIN_PASSWORD or Microsoft sign-in on the server to require sign-in.</p>}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-foreground">People &amp; sign-in<span className="brand-dot">.</span></h2>
        <UsersPanel />
      </section>
      <AdminDashboard />
      <section className="mt-10 rounded-control border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-foreground">Tool checker<span className="brand-dot">.</span></h2>
        <p className="mt-1 text-sm text-body">Run every tool with random generated input in your browser and get a working / not-working report with comments.</p>
        <a href="/admin/checker" className="mt-3 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent-hover">Open the tool checker</a>
      </section>
    </div>
  );
}
