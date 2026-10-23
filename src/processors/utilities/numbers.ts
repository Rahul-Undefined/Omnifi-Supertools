import type { CalcProcessor, TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { textOutput } from "../shared/output";

/** Number and time helpers: words, statistics, sequences, random, bytes, timesheet decimals, durations. */

const str = (v: unknown, d = "") => (v == null || v === "" ? d : String(v));
const n = (v: unknown, d = 0) => { const x = Number(String(v ?? "").replace(/[,$\s]/g, "")); return Number.isFinite(x) ? x : d; };

/* ---------- Number to words (US) ---------- */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion"];

function chunkWords(x: number): string {
  const h = Math.floor(x / 100), r = x % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r < 20) { if (r) parts.push(ONES[r]); }
  else parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  return parts.join(" ");
}

export function integerToWords(x: number): string {
  if (!Number.isFinite(x)) return "";
  if (x === 0) return "zero";
  const neg = x < 0; x = Math.floor(Math.abs(x));
  const parts: string[] = [];
  let i = 0;
  while (x > 0 && i < SCALES.length) { const c = x % 1000; if (c) parts.unshift(`${chunkWords(c)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`); x = Math.floor(x / 1000); i++; }
  return (neg ? "minus " : "") + parts.join(" ");
}

export function amountToWords(amount: number, currency = "dollar", cents = "cent", style: "check" | "words" | "plain" = "check"): string {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const frac = Math.round((Math.abs(amount) - whole) * 100);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (style === "check") return `${cap(integerToWords(whole))} and ${String(frac).padStart(2, "0")}/100 ${currency}s${amount < 0 ? " (negative)" : ""}`;
  if (style === "plain") return cap(integerToWords(whole)) + (frac ? ` point ${[...String(frac).padStart(2, "0")].map((d) => ONES[Number(d)] || "zero").join(" ")}` : "");
  return `${cap(integerToWords(whole))} ${currency}${whole === 1 ? "" : "s"}${frac ? ` and ${integerToWords(frac)} ${cents}${frac === 1 ? "" : "s"}` : ""}`;
}

const WORD_VALUES: Record<string, number> = Object.fromEntries([...ONES.map((w, i) => [w, i] as [string, number]).filter(([w]) => w), ...TENS.map((w, i) => [w, i * 10] as [string, number]).filter(([w]) => w), ["hundred", 100], ["thousand", 1e3], ["million", 1e6], ["billion", 1e9], ["trillion", 1e12]]);

export function wordsToNumber(text: string): number | null {
  const tokens = text.toLowerCase().replace(/-/g, " ").replace(/\band\b/g, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let total = 0, current = 0, any = false;
  for (const t of tokens) {
    const v = WORD_VALUES[t];
    if (v == null) { if (t === "zero") { any = true; continue; } return null; }
    any = true;
    if (v === 100) current = (current || 1) * 100;
    else if (v >= 1000) { total += (current || 1) * v; current = 0; }
    else current += v;
  }
  return any ? total + current : null;
}

export const numberToWords: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "toWords");
  const items = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!items.length) throw new ProcessorError(mode === "toWords" ? "Enter a number, one per line" : "Enter the words, one amount per line");
  const style = str(options.style, "check") as "check" | "words" | "plain";
  const currency = str(options.currency, "dollar");
  const out = items.map((it) => {
    if (mode === "toNumber") { const v = wordsToNumber(it.replace(/\b(dollars?|cents?)\b/gi, "").replace(/\d+\/100/g, "")); return v == null ? `${it} → (could not parse)` : `${it} → ${v.toLocaleString("en-US")}`; }
    const v = n(it, NaN);
    if (!Number.isFinite(v)) return `${it} → (not a number)`;
    if (Math.abs(v) >= 1e18) return `${it} → (too large)`;
    return `${it} → ${amountToWords(v, currency, "cent", style)}`;
  });
  return textOutput(out.join("\n"), out, { Converted: String(items.length) });
};

/* ---------- Statistics of pasted numbers ---------- */

export const numberStats: TextProcessor = async (input) => {
  const nums = (input.match(/-?\(?\$?[\d,]*\.?\d+\)?%?/g) ?? []).map((t) => { const neg = /^\(.*\)$/.test(t); const v = n(t.replace(/[()%]/g, "")); return neg ? -v : v; }).filter((v) => Number.isFinite(v));
  if (!nums.length) throw new ProcessorError("No numbers found", "Paste numbers separated by spaces, commas or new lines.");
  const sum = nums.reduce((a, b) => a + b, 0);
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = sum / nums.length;
  const median = nums.length % 2 ? sorted[(nums.length - 1) / 2] : (sorted[nums.length / 2 - 1] + sorted[nums.length / 2]) / 2;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const freq = new Map<number, number>(); for (const v of nums) freq.set(v, (freq.get(v) ?? 0) + 1);
  const modeN = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const stats = { Count: String(nums.length), Sum: fmt(sum), Average: fmt(mean), Median: fmt(median), Min: fmt(sorted[0]), Max: fmt(sorted[sorted.length - 1]), Range: fmt(sorted[sorted.length - 1] - sorted[0]), "Std dev": fmt(Math.sqrt(variance)), Mode: modeN[1] > 1 ? `${fmt(modeN[0])} (×${modeN[1]})` : "none", Product: Math.abs(nums.reduce((a, b) => a * b, 1)) < 1e15 ? fmt(nums.reduce((a, b) => a * b, 1)) : "very large" };
  return textOutput(Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join("\n"), { numbers: nums, ...stats }, stats);
};

/* ---------- Sequences & random ---------- */

export const sequence: CalcProcessor = async ({ options }) => {
  const mode = str(options.mode, "arithmetic");
  const start = n(options.start, 1), count = Math.min(10_000, Math.max(1, Math.floor(n(options.count, 10))));
  const step = n(options.step, 1);
  const out: number[] = [];
  if (mode === "geometric") { let v = start; for (let i = 0; i < count; i++) { out.push(v); v *= step || 2; } }
  else if (mode === "fibonacci") { let a = 0, b = 1; for (let i = 0; i < count; i++) { out.push(a); [a, b] = [b, a + b]; } }
  else if (mode === "primes") { let v = Math.max(2, Math.floor(start)); while (out.length < count && v < 1e7) { let p = true; for (let d = 2; d * d <= v; d++) if (v % d === 0) { p = false; break; } if (p) out.push(v); v++; } }
  else if (mode === "squares") { for (let i = 0; i < count; i++) out.push((start + i) ** 2); }
  else for (let i = 0; i < count; i++) out.push(start + i * step);
  const sep = str(options.separator, "newline") === "comma" ? ", " : str(options.separator) === "space" ? " " : "\n";
  const pad = Number(options.pad ?? 0);
  const text = out.map((v) => (pad > 0 ? String(v).padStart(pad, "0") : String(v))).join(sep);
  return textOutput(text, out, { Count: String(out.length), First: String(out[0]), Last: String(out[out.length - 1]) });
};

export const randomNumbers: CalcProcessor = async ({ options }) => {
  const min = n(options.min, 1), max = n(options.max, 100), count = Math.min(10_000, Math.max(1, Math.floor(n(options.count, 10))));
  if (max < min) throw new ProcessorError("Max must be at least Min");
  const decimals = Math.max(0, Math.min(6, Math.floor(n(options.decimals, 0))));
  const unique = Boolean(options.unique);
  const span = max - min;
  if (unique && decimals === 0 && count > span + 1) throw new ProcessorError(`Only ${span + 1} unique whole numbers exist between ${min} and ${max}`);
  const out: number[] = []; const seen = new Set<number>();
  const buf = new Uint32Array(1);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    const r = buf[0] / 2 ** 32;
    const v = decimals ? Number((min + r * span).toFixed(decimals)) : min + Math.floor(r * (span + 1));
    if (unique) { if (seen.has(v)) continue; seen.add(v); }
    out.push(v);
  }
  if (options.sort) out.sort((a, b) => a - b);
  const sep = str(options.separator, "newline") === "comma" ? ", " : str(options.separator) === "space" ? " " : "\n";
  return textOutput(out.join(sep), out, { Count: String(out.length), Range: `${min} – ${max}`, Source: "crypto.getRandomValues" });
};

/* ---------- Bytes ---------- */

const UNITS: [string, number][] = [["B", 1], ["KB", 1e3], ["MB", 1e6], ["GB", 1e9], ["TB", 1e12], ["PB", 1e15], ["KiB", 1024], ["MiB", 1024 ** 2], ["GiB", 1024 ** 3], ["TiB", 1024 ** 4], ["PiB", 1024 ** 5], ["bit", 1 / 8], ["Kbit", 125], ["Mbit", 125e3], ["Gbit", 125e6]];

export const byteConverter: CalcProcessor = async ({ options }) => {
  const value = n(options.value, 1);
  const from = str(options.from, "MB");
  const unit = UNITS.find(([u]) => u.toLowerCase() === from.toLowerCase());
  if (!unit) throw new ProcessorError(`Unknown unit "${from}"`, `Use one of: ${UNITS.map(([u]) => u).join(", ")}`);
  const bytes = value * unit[1];
  const rows = UNITS.map(([u, f]) => [u, bytes / f]).filter(([, v]) => (v as number) >= 1e-6 && (v as number) < 1e18);
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 6 : v < 1000 ? 3 : 0 });
  const text = rows.map(([u, v]) => `${fmt(v as number)} ${u}`).join("\n");
  return { ...textOutput(text, Object.fromEntries(rows), { Input: `${value} ${unit[0]}`, Bytes: fmt(bytes) }), data: { header: ["Unit", "Value"], rows: rows.map(([u, v]) => [u as string, fmt(v as number)]) } };
};

/* ---------- Time ---------- */

export const timeDecimal: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "toDecimal");
  const items = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!items.length) throw new ProcessorError(mode === "toDecimal" ? "Enter times like 7:45 or 1h 20m, one per line" : "Enter decimal hours like 7.75, one per line");
  const rounding = n(options.round, 0); // minutes to round to (0 = exact)
  let total = 0;
  const out = items.map((it) => {
    if (mode === "toDecimal") {
      let minutes: number | null = null;
      const hm = it.match(/^(-?\d+):(\d{1,2})(?::(\d{1,2}))?$/);
      const hw = it.match(/^(-?\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/i);
      const mw = it.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/i);
      if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]) + Number(hm[3] ?? 0) / 60;
      else if (hw) minutes = Number(hw[1]) * 60 + Number(hw[2] ?? 0);
      else if (mw) minutes = Number(mw[1]);
      if (minutes == null) return `${it} → (not understood)`;
      if (rounding > 0) minutes = Math.round(minutes / rounding) * rounding;
      const dec = minutes / 60; total += dec;
      return `${it} → ${dec.toFixed(2)} h`;
    }
    const v = n(it, NaN);
    if (!Number.isFinite(v)) return `${it} → (not a number)`;
    let mins = Math.round(v * 60); if (rounding > 0) mins = Math.round(mins / rounding) * rounding;
    total += mins / 60;
    return `${it} → ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  });
  const totalText = mode === "toDecimal" ? `${total.toFixed(2)} h` : `${Math.floor(total)}:${String(Math.round((total % 1) * 60)).padStart(2, "0")}`;
  return textOutput(`${out.join("\n")}\n\nTotal: ${totalText}`, out, { Entries: String(items.length), Total: totalText });
};

export const durationConvert: CalcProcessor = async ({ options }) => {
  const value = n(options.value, 1);
  const from = str(options.from, "hours");
  const factors: Record<string, number> = { milliseconds: 1 / 1000, seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800, months: 2629800, years: 31557600, "work days (8h)": 28800, "work weeks (40h)": 144000 };
  const f = factors[from];
  if (!f) throw new ProcessorError(`Unknown unit "${from}"`);
  const secs = value * f;
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 2 });
  const rows = Object.entries(factors).map(([u, k]) => [u, fmt(secs / k)]);
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = Math.round(secs % 60);
  const human = [d ? `${d} d` : "", h ? `${h} h` : "", m ? `${m} min` : "", s || (!d && !h && !m) ? `${s} s` : ""].filter(Boolean).join(" ");
  const hms = `${Math.floor(secs / 3600)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return { ...textOutput(`${value} ${from} = ${human} (${hms})\n\n${rows.map(([u, v]) => `${v} ${u}`).join("\n")}`, Object.fromEntries(rows), { Input: `${value} ${from}`, "As h:mm:ss": hms, Readable: human }), data: { header: ["Unit", "Value"], rows } };
};

export const leapYear: TextProcessor = async (input, { options }) => {
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const mode = str(options.mode, "check");
  if (mode === "list") {
    const from = n(options.from, new Date().getFullYear()), to = n(options.to, from + 20);
    if (to < from || to - from > 2000) throw new ProcessorError("Enter a range of at most 2,000 years");
    const years: number[] = []; for (let y = from; y <= to; y++) if (isLeap(y)) years.push(y);
    return textOutput(years.join("\n") || "No leap years in that range", years, { "Leap years": String(years.length), Range: `${from}–${to}` });
  }
  const items = (input.match(/\d{1,6}/g) ?? []).map(Number);
  if (!items.length) throw new ProcessorError("Enter one or more years");
  const out = items.map((y) => `${y}: ${isLeap(y) ? "leap year (366 days, Feb 29 exists)" : "not a leap year (365 days)"}`);
  return textOutput(out.join("\n"), out, { Checked: String(items.length) });
};
