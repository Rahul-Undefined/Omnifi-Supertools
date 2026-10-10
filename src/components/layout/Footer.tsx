import Link from "next/link";
import { Logo } from "./Logo";
import { registryStats } from "@/tools/registry";

export function Footer() {
  const s = registryStats();
  return (
    <footer className="border-t border-border bg-background-soft">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div>
          <Logo size="sm" />
          <p className="mt-3 text-sm text-muted max-w-xs">One place for the tools you actually need. Files are processed in your browser wherever possible.</p>
        </div>
        <FooterCol title="Product" links={[["/tools", "All tools"], ["/workflows", "Workflows"], ["/ai", "AI tools"], ["/help", "Help & shortcuts"], ["/feedback", "Share an idea"]]} />
        <FooterCol title="You" links={[["/favorites", "Favorites"], ["/recent", "Recently used"], ["/help", "Help & shortcuts"]]} />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Status</h3>
          <ul className="mt-3 space-y-1.5 text-sm text-muted">
            <li><span className="font-medium text-accent">{s.ready}</span> tools ready</li>
            <li>{s.comingSoon} marked coming soon</li>
            <li>{s.categories} categories</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>© {new Date().getFullYear()} Omnifi. Internal use only.</span>
          <span>Uploaded files for server-side tools are deleted automatically after processing.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-1.5">
        {links.map(([href, label]) => (
          <li key={href}><Link href={href} className="text-sm text-muted hover:text-accent transition-colors">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
