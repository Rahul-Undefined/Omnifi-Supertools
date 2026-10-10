"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck, Lightbulb, Star, Clock } from "lucide-react";
import { useSession } from "@/store/session";

export function UserMenu() {
  const { user, loaded, meta, refresh } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!loaded) return <span className="h-10 w-10 rounded-full bg-surface-2" aria-hidden />;
  if (!user) {
    if (meta && !meta.required) return null;
    return <Link href="/login" className="h-10 inline-flex items-center rounded-control border border-border-strong px-3.5 text-sm font-medium text-body hover:border-accent hover:text-accent transition-colors">Sign in</Link>;
  }
  const first = user.firstName ?? user.name.split(" ")[0];
  const initials = user.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <span className="hidden xl:inline whitespace-nowrap text-sm text-body">Hi, <span className="font-medium text-foreground">{first}</span></span>
      <button type="button" onClick={() => setOpen((o) => !o)} className="h-10 w-10 rounded-full bg-accent text-accent-foreground text-sm font-semibold inline-flex items-center justify-center hover:bg-accent-hover transition-colors" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}>
        {initials || "?"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 w-60 rounded-control border border-border bg-surface p-1.5 shadow-float animate-fade-up z-50">
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted truncate">{user.email}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{user.role}{user.via === "microsoft" ? " · Microsoft" : ""}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href="/favorites" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm text-body hover:bg-surface-2"><Star className="h-4 w-4" /> Favorites</Link>
          <Link href="/recent" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm text-body hover:bg-surface-2"><Clock className="h-4 w-4" /> Recently used</Link>
          <Link href="/feedback" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm text-body hover:bg-surface-2"><Lightbulb className="h-4 w-4" /> Share an idea</Link>
          {user.role === "admin" && <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm text-body hover:bg-surface-2"><ShieldCheck className="h-4 w-4" /> Admin</Link>}
          <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); setOpen(false); await refresh(); router.replace("/login"); }} className="flex w-full items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm text-body hover:bg-surface-2"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      )}
    </div>
  );
}
