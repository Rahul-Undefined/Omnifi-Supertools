"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { useSession } from "@/store/session";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin";
  const { user, refresh } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ mode: string; configured: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMeta({ mode: d.mode, configured: d.configured })).catch(() => setMeta({ mode: "local", configured: false }));
  }, []);

  useEffect(() => {
    if (user) router.replace(next.startsWith("/") ? next : "/");
  }, [user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data.error ?? "Sign-in failed", hint: data.hint });
        return;
      }
      await refresh();
      router.replace(next.startsWith("/") ? next : "/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-navy-800">
      <span className="motif -right-10 -top-10 h-64 w-64 opacity-60" aria-hidden />
      <div className="relative mx-auto flex max-w-md flex-col px-4 py-20">
        <div className="rounded-control border border-[rgba(139,145,227,0.2)] bg-surface p-8 shadow-float">
          <Logo href={null} />
          <h1 className="mt-6 text-2xl font-semibold text-foreground">Sign in<span className="brand-dot">.</span></h1>
          <p className="mt-1 text-sm text-muted">Sign in to access the admin dashboard. Tools work without signing in.</p>
          <p className="mt-1 text-xs text-muted">Username is <code className="font-mono">admin</code> unless your administrator set up named accounts.</p>
          {meta && meta.mode === "header" ? (
            <p className="mt-6 rounded-control-sm bg-surface-2 px-4 py-3 text-sm text-body">Sign-in is handled by your identity provider. If you can read this, the proxy did not pass your identity through. Contact the SuperTools admin.</p>
          ) : meta && !meta.configured ? (
            <p className="mt-6 rounded-control-sm bg-warning-soft px-4 py-3 text-sm text-body">No accounts are configured on this server yet. Set <code className="font-mono">ADMIN_PASSWORD</code> (and optionally <code className="font-mono">USERS_JSON</code>) in the environment. See docs/DEPLOYMENT.md.</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && (
                <p className="rounded-control-sm bg-error-soft px-3.5 py-2.5 text-sm text-foreground">{error.message}{error.hint && <span className="block text-xs text-body">{error.hint}</span>}</p>
              )}
              <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
