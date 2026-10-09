export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/branding/mark.svg" alt="" className="h-12 text-accent animate-pulse" />
        <span className="text-sm text-muted">Loading…</span>
      </div>
    </div>
  );
}
