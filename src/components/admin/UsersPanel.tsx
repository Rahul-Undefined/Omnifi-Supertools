"use client";
import { useEffect, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Card";

interface Account { username: string; name: string; email: string; role: "admin" | "user"; createdAt: number }
interface Info { accounts: Account[]; microsoft: boolean; allowedDomains: string[]; adminEmails: string[]; persistent: boolean }

export function UsersPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [form, setForm] = useState({ username: "", name: "", email: "", role: "user", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then(setInfo).catch(() => setInfo(null));
  useEffect(() => { let c = false; fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (!c) setInfo(d); }).catch(() => {}); return () => { c = true; }; }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.hint ?? data.error ?? "Could not create the account" }); return; }
      setMsg({ ok: true, text: `Account ${data.account.username} created. Share the username and password with them privately.` });
      setForm({ username: "", name: "", email: "", role: "user", password: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (username: string) => {
    if (!confirm(`Remove ${username}? They will no longer be able to sign in.`)) return;
    await fetch("/api/admin/users", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
    await load();
  };

  if (!info) return <div className="h-32 animate-pulse rounded-control bg-surface-2" />;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-control border border-border bg-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted">Microsoft sign-in</p><p className="mt-1"><Badge tone={info.microsoft ? "success" : "warning"}>{info.microsoft ? "Configured" : "Not configured"}</Badge></p><p className="mt-2 text-xs text-muted">{info.microsoft ? `Allowed domains: ${info.allowedDomains.join(", ") || "any"}` : "Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID in Render."}</p></div>
        <div className="rounded-control border border-border bg-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted">Admins by email</p><p className="mt-1 text-body">{info.adminEmails.length ? info.adminEmails.join(", ") : "None (set ADMIN_EMAILS)"}</p></div>
        <div className="rounded-control border border-border bg-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted">Account storage</p><p className="mt-1"><Badge tone={info.persistent ? "success" : "warning"}>{info.persistent ? "PostgreSQL" : "Temporary file"}</Badge></p>{!info.persistent && <p className="mt-2 text-xs text-muted">Accounts created here are lost on the next redeploy until DATABASE_URL is set. Microsoft sign-in needs no storage.</p>}</div>
      </div>

      <div className="overflow-auto rounded-control border border-border">
        <table className="w-full text-sm">
          <thead className="bg-navy-800 text-white"><tr><th className="px-3 py-2 text-left font-semibold">Username</th><th className="px-3 py-2 text-left font-semibold">Name</th><th className="px-3 py-2 text-left font-semibold">Email</th><th className="px-3 py-2 text-left font-semibold">Role</th><th className="px-3 py-2 text-left font-semibold">Created</th><th /></tr></thead>
          <tbody>
            {info.accounts.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No named accounts yet. The admin account from ADMIN_PASSWORD always works.</td></tr>}
            {info.accounts.map((a) => (
              <tr key={a.username} className="odd:bg-surface even:bg-surface-2">
                <td className="px-3 py-2 font-mono text-xs">{a.username}</td><td className="px-3 py-2">{a.name}</td><td className="px-3 py-2">{a.email}</td><td className="px-3 py-2"><Badge tone={a.role === "admin" ? "accent" : "neutral"}>{a.role}</Badge></td><td className="px-3 py-2 text-muted">{new Date(a.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right"><button type="button" onClick={() => remove(a.username)} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-error" aria-label={`Remove ${a.username}`}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="rounded-control border border-border bg-surface p-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Add a named account</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label htmlFor="u-username">Username</Label><Input id="u-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required placeholder="priya" /></div>
          <div><Label htmlFor="u-name">Full name</Label><Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya Sharma" /></div>
          <div><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="priya@myomnifi.com" /></div>
          <div><Label htmlFor="u-role">Role</Label><Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="user">User</option><option value="admin">Admin</option></Select></div>
          <div><Label htmlFor="u-password">Temporary password</Label><Input id="u-password" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} placeholder="min 8 characters" /></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={busy}><UserPlus className="h-4 w-4" /> Create account</Button>
          {msg && <span className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}
