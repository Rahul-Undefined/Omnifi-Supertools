"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Menu, X } from "lucide-react";
import { useState } from "react";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { Kbd } from "@/components/ui/Card";
import { openPalette } from "./CommandPalette";

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
            {site.nav.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-control-sm px-3 py-2 text-sm font-medium transition-colors duration-200",
                    active ? "bg-accent-soft text-accent" : "text-body hover:text-foreground hover:bg-surface-2",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openPalette}
            className="hidden sm:flex h-10 items-center gap-3 rounded-control border border-border-strong bg-surface px-3.5 text-sm text-muted hover:border-accent hover:text-foreground transition-colors duration-200 w-56 lg:w-72"
            aria-label="Search tools"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left truncate">Search tools…</span>
            <span className="hidden md:flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
          <button type="button" onClick={openPalette} className="sm:hidden h-10 w-10 inline-flex items-center justify-center rounded-control text-body hover:bg-surface-2" aria-label="Search tools">
            <Search className="h-5 w-5" />
          </button>
          <ThemeToggle />
          <UserMenu />
          <button type="button" onClick={() => setOpen((o) => !o)} className="lg:hidden h-10 w-10 inline-flex items-center justify-center rounded-control text-body hover:bg-surface-2" aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="lg:hidden border-t border-border bg-background px-4 py-3 grid gap-1 animate-fade-up" aria-label="Primary mobile">
          {site.nav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={cn("rounded-control-sm px-3 py-2.5 text-sm font-medium", path.startsWith(n.href) && n.href !== "/" ? "bg-accent-soft text-accent" : "text-body hover:bg-surface-2")}>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
