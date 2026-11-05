"use client";
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const KEY = "omnifi.aiBetaNotice.v1";

/**
 * Small pop-up shown the first time an AI tool is opened in a browser session:
 * the AI tools run on a free provider tier and can fail under heavy use.
 */
export function AiBetaNotice() {
  // Starts closed so server HTML and the first client render match; opens after mount if not seen this session.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      let seen = false;
      try { seen = sessionStorage.getItem(KEY) === "1"; } catch { /* storage blocked: show it */ }
      setOpen(!seen);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={dismiss} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="ai-beta-title" className="w-full max-w-md rounded-control border border-border bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-control bg-accent-soft text-accent"><Sparkles className="h-5 w-5" /></span>
            <h2 id="ai-beta-title" className="text-base font-semibold text-foreground">AI tools are in beta<span className="brand-dot">.</span></h2>
          </div>
          <button type="button" onClick={dismiss} aria-label="Close" className="rounded-control p-1 text-muted hover:bg-surface-2 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-4 text-sm text-body">The AI tools currently run on a free provider tier, so a request can fail or feel slow when many people use them at the same time. If that happens, wait a minute and try again.</p>
        <p className="mt-2 text-sm text-body">We are working on moving to a paid plan with a stronger model that can take the load. Sorry for the inconvenience in the meantime.</p>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={dismiss}>Got it</Button>
        </div>
      </div>
    </div>
  );
}
