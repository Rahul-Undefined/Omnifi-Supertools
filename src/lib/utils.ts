import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(digits)} ${units[i]}`;
}

export function percentSaved(original: number, output: number): string {
  if (original <= 0) return "0%";
  const saved = ((original - output) / original) * 100;
  return `${saved.toFixed(1)}%`;
}

export function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function withSuffix(name: string, suffix: string, ext?: string): string {
  const base = baseName(name);
  const e = ext ?? extOf(name);
  return e ? `${base}${suffix}.${e}` : `${base}${suffix}`;
}

/** Safe file name for downloads: strips path separators and control chars. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.\.+/g, ".").trim();
  return cleaned.length ? cleaned.slice(0, 180) : "download";
}

export function formatNumber(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatCurrency(n: number, currency = "USD"): string {
  try {
    return n.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
