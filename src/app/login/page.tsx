"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { useSession } from "@/store/session";

const ERRORS: Record<string, string> = {
  "microsoft-not-configured": "Microsoft sign-in is not set up on this server yet.",
  "microsoft-denied": "Microsoft sign-in was cancelled.",
  "domain-not-allowed": "That Microsoft account is not part of Omnifi. Use your Omnifi work account.",
  "session-expired": "The sign-in took too long. Try again.",
  "state-mismatch": "The sign-in could not be verified. Try again.",
  "token-exchange": "Microsoft did not accept the sign-in. Try again or contact the admin.",
  "token-invalid": "Microsoft returned an invalid token. Contact the admin.",
  "no-email": "Your Microsoft account has no email address we can use.",
};

/** Plain-English hints for the Microsoft error codes an admin is most likely to hit. */
const AAD_HINTS: Record<string, string> = {
  AADSTS7000215: "The client secret is wrong. In Azure, copy the secret's Value column (not the Secret ID) into AZURE_CLIENT_SECRET.",
  AADSTS7000222: "The client secret has expired. Create a new one in Azure and update AZURE_CLIENT_SECRET.",
  AADSTS50011: "The redirect URI does not match. In Azure, add exactly https://omnifi-supertools.onrender.com/api/auth/microsoft/callback as a Web redirect URI.",
  AADSTS700016: "The app was not found in this tenant. Check AZURE_CLIENT_ID and AZURE_TENANT_ID match the app registration.",
  AADSTS90002: "The tenant ID is wrong. Use the Directory (tenant) ID from the app's Overview page.",
  AADSTS65001: "Admin consent is missing. In Azure, under API permissions, click 'Grant admin consent'.",
  AADSTS700051: "The response type is not enabled. In Azure under Authentication, make sure the redirect URI is of type Web.",
  AADSTS50194: "The app is single-tenant but AZURE_TENANT_ID is 'common'. Set it to your Directory (tenant) ID.",
  AADSTS7000218: "The app is treated as a public client. In Azure under Authentication, set 'Allow public client flows' to No and use a Web redirect URI.",
};

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
  const next = params.get("next") || "/";
  const safeNext = next.startsWith("/") ? next : "/";
  const { user, refresh, meta } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showLocal, setShowLocal] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(() => {
    const e = params.get("error");
    if (!e) return null;
    const detail = params.get("detail") ?? "";
    const code = detail.match(/AADSTS\d+/)?.[0];
    const hint = code ? `${code}: ${AAD_HINTS[code] ?? "Look this code up in the Render logs or Microsoft docs."}` : detail || undefined;
    return { message: ERRORS[e] ?? "Sign-in failed. Try again.", hint };
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(safeNext);
  }, [user, safeNext, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, remember }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data.error ?? "Sign-in failed", hint: data.hint });
        return;
      }
      await refresh();
      router.replace(safeNext);
    } finally {
      setBusy(false);
    }
  };

  const microsoft = meta?.methods.microsoft ?? false;
  const localFirst = !microsoft || showLocal;

  return (
    <div className="hero-animated relative min-h-[calc(100vh-4rem)] overflow-hidden bg-navy-800">
      <span className="hero-blob hero-blob-a" aria-hidden />
      <span className="hero-blob hero-blob-b" aria-hidden />
      <span className="motif hero-motif -right-10 -top-10 h-64 w-64 opacity-60" aria-hidden />
      <div className="relative mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
        <div className="rounded-control border border-[rgba(139,145,227,0.2)] bg-surface p-8 shadow-float animate-fade-up">
          <Logo href={null} />
          <h1 className="mt-6 text-2xl font-semibold text-foreground">Welcome back<span className="brand-dot">.</span></h1>
          <p className="mt-1 text-sm text-muted">Sign in with your Omnifi account to open the toolbox.</p>

          {meta && !meta.required && (
            <p className="mt-6 rounded-control-sm bg-surface-2 px-4 py-3 text-sm text-body">No sign-in method is configured on this server yet, so everything is open. An administrator can set ADMIN_PASSWORD or Microsoft sign-in.</p>
          )}

          {microsoft && (
            <div className="mt-6 space-y-3">
              <a href={`/api/auth/microsoft?next=${encodeURIComponent(safeNext)}&remember=${remember ? 1 : 0}`} className="flex h-12 w-full items-center justify-center gap-3 rounded-control border border-border-strong bg-surface text-sm font-medium text-foreground transition-colors hover:border-accent hover:bg-surface-2">
                <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden><rect x="1" y="1" width="10" height="10" fill="#F25022" /><rect x="12" y="1" width="10" height="10" fill="#7FBA00" /><rect x="1" y="12" width="10" height="10" fill="#00A4EF" /><rect x="12" y="12" width="10" height="10" fill="#FFB900" /></svg>
                Continue with Microsoft
              </a>
              <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--indigo)]" /> Keep me signed in on this device
              </label>
              {!showLocal && (
                <button type="button" onClick={() => setShowLocal(true)} className="text-xs text-muted hover:text-accent">Sign in with a username and password instead</button>
              )}
            </div>
          )}

          {localFirst && (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="username">Username or email</Label>
                <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!microsoft} />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {!microsoft && (
                <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer select-none">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--indigo)]" /> Keep me signed in on this device
                </label>
              )}
              <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
            </form>
          )}

          {error && (
            <p className="mt-4 rounded-control-sm bg-error-soft px-3.5 py-2.5 text-sm text-foreground">{error.message}{error.hint && <span className="block text-xs text-body">{error.hint}</span>}</p>
          )}
          <p className="mt-6 text-xs text-muted">Your files are processed in your browser and never stored. Signing in only identifies you to the team and the admin.</p>
        </div>
      </div>
    </div>
  );
}
