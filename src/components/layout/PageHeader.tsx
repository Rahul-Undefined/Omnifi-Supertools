import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ToolIcon } from "@/components/tools/ToolIcon";

export function PageHeader({ title, description, icon, crumbs, actions }: { title: string; description?: string; icon?: string; crumbs?: { href: string; label: string }[]; actions?: React.ReactNode }) {
  return (
    <div className="mb-8">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-3 flex items-center gap-1 text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-accent">Home</Link>
          {crumbs.map((c) => (
            <span key={c.href} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5" /><Link href={c.href} className="hover:text-accent">{c.label}</Link></span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {icon && <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control-sm bg-accent-soft text-accent"><ToolIcon name={icon} className="h-6 w-6" /></span>}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}<span className="brand-dot">.</span></h1>
            {description && <p className="mt-1 max-w-2xl text-body">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
