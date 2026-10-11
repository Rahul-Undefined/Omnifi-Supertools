import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { Logo } from "./Logo";
import { site } from "@/config/site";
import { registryStats } from "@/tools/registry";

export function Footer() {
  const s = registryStats();
  return (
    <footer className="border-t border-border bg-background-soft">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-2 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr]">
        <div className="sm:col-span-2 md:col-span-1">
          <Logo size="sm" />
          <p className="mt-3 text-sm text-muted max-w-xs">One place for the tools you actually need. Files are processed in your browser wherever possible.</p>
          <a href={site.links.website} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-control border border-border-strong px-3 py-1.5 text-sm font-medium text-body hover:border-accent hover:text-accent transition-colors">
            Visit the Omnifi website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
        <FooterCol title="Product" links={[["/tools", "All tools"], ["/workflows", "Workflows"], ["/ai", "AI tools"], ["/help", "Help & shortcuts"], ["/feedback", "Share an idea"]]} />
        <FooterCol title="You" links={[["/favorites", "Favorites"], ["/recent", "Recently used"], ["/downloads", "Downloads"]]} />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Omnifi</h3>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href={site.links.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-accent transition-colors">Omnifi website <ExternalLink className="h-3 w-3" aria-hidden /></a></li>
            <li><a href={site.links.techHub} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-accent transition-colors">Tech Hub (SharePoint) <ExternalLink className="h-3 w-3" aria-hidden /></a></li>
            <li><Link href="/downloads" className="text-muted hover:text-accent transition-colors">Steps Recorder download</Link></li>
          </ul>
        </div>
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
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted">
          <span>© {new Date().getFullYear()} Omnifi. Internal use only.</span>
          <span className="inline-flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" aria-hidden />
            Any issue or idea? Contact {site.support.name} at <a href={`mailto:${site.support.email}`} className="font-medium text-body hover:text-accent">{site.support.email}</a>
          </span>
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
