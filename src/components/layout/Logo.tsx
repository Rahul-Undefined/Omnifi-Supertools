import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The official OmniFi logo (public/branding/omnifi-logo.svg) followed by the
 * product name. The logo is never recoloured or stretched: in dark mode we
 * invert only the navy paths via a CSS filter-free approach, using the
 * white-on-dark variant file.
 */
export function Logo({ className, size = "md", href = "/" }: { className?: string; size?: "sm" | "md" | "lg"; href?: string | null }) {
  const h = size === "lg" ? 40 : size === "sm" ? 22 : 28;
  const w = Math.round(h * (160 / 43));
  const inner = (
    <span className={cn("inline-flex items-end gap-3", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/branding/omnifi-logo.svg" alt="OmniFi" width={w} height={h} className="block dark:hidden" style={{ height: h, width: w }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/branding/omnifi-logo-white.svg" alt="OmniFi" width={w} height={h} className="hidden dark:block" style={{ height: h, width: w }} />
      <span aria-hidden className="mb-[2px] h-5 w-px bg-border-strong" />
      {/* Baseline alignment: the wordmark's baseline sits at the very bottom of the SVG, while a
          text box keeps ~0.22em of descender space below its baseline, so the text is pushed down by that amount. */}
      <span className={cn("font-semibold leading-none tracking-tight text-foreground", size === "lg" ? "-mb-[5px] text-2xl" : size === "sm" ? "-mb-[3px] text-sm" : "-mb-[4px] text-lg")}>
        SuperTools
      </span>
    </span>
  );
  return href ? <Link href={href} aria-label="OmniFi SuperTools home" className="rounded-md">{inner}</Link> : inner;
}
