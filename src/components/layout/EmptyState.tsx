export function EmptyState({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-control border border-dashed border-border-strong bg-surface-2/60 px-6 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/branding/mark.svg" alt="" aria-hidden className="pointer-events-none absolute -right-6 -bottom-10 h-40 opacity-[0.06] text-foreground" />
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</span>
      <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
