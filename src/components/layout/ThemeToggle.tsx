"use client";
import { Moon, Sun, Monitor } from "lucide-react";
import { usePrefs, type Theme } from "@/store/prefs";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const Icon = options.find((o) => o.value === theme)?.icon ?? Monitor;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="h-10 w-10 inline-flex items-center justify-center rounded-control text-body hover:bg-surface-2 transition-colors" aria-label="Theme" aria-haspopup="menu" aria-expanded={open}>
        <Icon className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-40 rounded-control border border-border bg-surface p-1.5 shadow-float animate-fade-up z-50">
          {options.map((o) => (
            <button key={o.value} role="menuitemradio" aria-checked={theme === o.value} type="button" onClick={() => { setTheme(o.value); setOpen(false); }} className={cn("flex w-full items-center gap-2.5 rounded-control-sm px-3 py-2 text-sm transition-colors", theme === o.value ? "bg-accent-soft text-accent" : "text-body hover:bg-surface-2")}>
              <o.icon className="h-4 w-4" /> {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
