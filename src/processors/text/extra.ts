import type { TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { textOutput } from "../shared/output";

/** Everyday text and list utilities (find & replace, line tools, frequency, slug, table conversion…). */

const lines = (s: string) => s.split(/\r?\n/);
const nonEmpty = (s: string) => lines(s).filter((l) => l.trim() !== "");
const str = (v: unknown, d = "") => (v == null || v === "" ? d : String(v));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findReplace: TextProcessor = async (input, { options }) => {
  const find = str(options.find);
  if (!find) throw new ProcessorError("Enter the text to find");
  const flags = `g${options.caseSensitive ? "" : "i"}${options.multiline ? "m" : ""}`;
  let re: RegExp;
  try {
    const src = options.regex ? find : escapeRe(find);
    re = new RegExp(options.wholeWord ? `\\b(?:${src})\\b` : src, flags);
  } catch (e) {
    throw new ProcessorError("Invalid regular expression", e instanceof Error ? e.message : undefined);
  }
  const replacement = str(options.replace).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  let count = 0;
  const out = input.replace(re, (...m) => { count++; return options.regex ? replacement.replace(/\$(\d)/g, (_, i) => String(m[Number(i)] ?? "")) : replacement; });
  return textOutput(out, undefined, { Replacements: String(count) });
};

const INVISIBLE: Record<string, string> = {
  " ": "no-break space", "​": "zero-width space", "‌": "zero-width non-joiner", "‍": "zero-width joiner", "⁠": "word joiner", "﻿": "byte-order mark",
  "­": "soft hyphen", " ": "line separator", " ": "paragraph separator", "‪": "LTR embedding", "‫": "RTL embedding", "‬": "pop directional", "‭": "LTR override", "‮": "RTL override",
  "⁦": "LTR isolate", "⁧": "RTL isolate", "⁩": "pop isolate", "᠎": "Mongolian vowel separator", "͏": "combining grapheme joiner", "؜": "Arabic letter mark",
  " ": "en space", " ": "em space", " ": "thin space", " ": "hair space", " ": "narrow no-break space", "　": "ideographic space", "\t": "tab", "\r": "carriage return",
};

export const hiddenChars: TextProcessor = async (input, { options }) => {
  const found = new Map<string, { name: string; count: number; positions: number[] }>();
  const chars = [...input];
  let lineNo = 1; let col = 0;
  const report: string[] = [];
  for (const ch of chars) {
    if (ch === "\n") { lineNo++; col = 0; continue; }
    col++;
    const code = ch.codePointAt(0)!;
    const name = INVISIBLE[ch] ?? (code >= 0x7f && code <= 0x9f ? "control character" : code < 0x20 && ch !== "\t" && ch !== "\r" ? "control character" : /\p{Cf}/u.test(ch) ? "format character" : null);
    if (name) {
      const e = found.get(ch) ?? { name, count: 0, positions: [] };
      e.count++; if (e.positions.length < 20) e.positions.push(lineNo);
      found.set(ch, e);
      if (report.length < 200) report.push(`line ${lineNo}, col ${col}: U+${code.toString(16).toUpperCase().padStart(4, "0")} ${name}`);
    }
  }
  const cleaned = options.clean === false ? undefined : chars.map((ch) => (INVISIBLE[ch] && ch !== "\t" && ch !== "\r" ? (ch === " " || / | | | | |　/.test(ch) ? " " : "") : /\p{Cf}/u.test(ch) ? "" : ch)).join("");
  const summary = [...found.entries()].map(([ch, e]) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} ${e.name}: ${e.count}`).join("\n");
  const text = found.size ? `${found.size} kind(s) of hidden characters found:\n${summary}\n\nLocations:\n${report.join("\n")}\n\n--- Cleaned text ---\n${cleaned ?? ""}` : "No hidden or invisible characters found.";
  return textOutput(text, { found: [...found.entries()].map(([ch, e]) => ({ char: `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`, ...e })), cleaned }, { "Hidden characters": String([...found.values()].reduce((a, e) => a + e.count, 0)), Kinds: String(found.size) });
};

export const joinLines: TextProcessor = async (input, { options }) => {
  const sep = str(options.separator, ", ").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  const items = (options.skipEmpty === false ? lines(input) : nonEmpty(input)).map((l) => (options.trim === false ? l : l.trim()));
  return textOutput(items.join(sep), undefined, { Lines: String(items.length) });
};

export const splitText: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "separator");
  let parts: string[];
  if (mode === "length") { const n = Math.max(1, Number(options.length ?? 80)); parts = []; for (let i = 0; i < input.length; i += n) parts.push(input.slice(i, i + n)); }
  else if (mode === "words") { const n = Math.max(1, Number(options.length ?? 100)); const w = input.split(/\s+/).filter(Boolean); parts = []; for (let i = 0; i < w.length; i += n) parts.push(w.slice(i, i + n).join(" ")); }
  else if (mode === "regex") { try { parts = input.split(new RegExp(str(options.separator, "\\n"))); } catch (e) { throw new ProcessorError("Invalid regular expression", e instanceof Error ? e.message : undefined); } }
  else { const sep = str(options.separator, ",").replace(/\\n/g, "\n").replace(/\\t/g, "\t"); parts = input.split(sep); }
  if (options.trim !== false) parts = parts.map((p) => p.trim());
  if (options.skipEmpty !== false) parts = parts.filter(Boolean);
  return textOutput(parts.join("\n"), parts, { Parts: String(parts.length) });
};

export const prefixSuffix: TextProcessor = async (input, { options }) => {
  const prefix = str(options.prefix), suffix = str(options.suffix);
  const remove = Boolean(options.remove);
  const out = lines(input).map((l) => {
    if (options.skipEmpty !== false && !l.trim()) return l;
    if (remove) { let s = l; if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length); if (suffix && s.endsWith(suffix)) s = s.slice(0, -suffix.length); return s; }
    return `${prefix}${l}${suffix}`;
  });
  return textOutput(out.join("\n"), undefined, { Lines: String(out.length) });
};

export const extractSubstring: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "position");
  if (mode === "between") {
    const a = str(options.start), b = str(options.end);
    if (!a || !b) throw new ProcessorError("Enter the start and end markers");
    const re = new RegExp(`${escapeRe(a)}([\\s\\S]*?)${escapeRe(b)}`, "g");
    const found = [...input.matchAll(re)].map((m) => m[1].trim());
    if (!found.length) throw new ProcessorError("No text found between those markers");
    return textOutput(found.join("\n"), found, { Matches: String(found.length) });
  }
  if (mode === "regex") {
    let re: RegExp;
    try { re = new RegExp(str(options.pattern), "g"); } catch (e) { throw new ProcessorError("Invalid regular expression", e instanceof Error ? e.message : undefined); }
    const found = [...input.matchAll(re)].map((m) => m[1] ?? m[0]);
    if (!found.length) throw new ProcessorError("No matches");
    return textOutput(found.join("\n"), found, { Matches: String(found.length) });
  }
  const start = Math.max(1, Number(options.from ?? 1)), len = Number(options.length ?? 10);
  const perLine = options.perLine !== false;
  const take = (s: string) => s.slice(start - 1, len > 0 ? start - 1 + len : undefined);
  const out = perLine ? lines(input).map(take).join("\n") : take(input);
  return textOutput(out);
};

function seededShuffle<T>(arr: T[], seed?: number): T[] {
  const a = [...arr];
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = () => { s = (s * 1664525 + 1013904223) % 2 ** 32; return s / 2 ** 32; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const shuffleLines: TextProcessor = async (input, { options }) => {
  const items = nonEmpty(input);
  if (!items.length) throw new ProcessorError("Paste a list, one item per line");
  const seed = str(options.seed) ? Number(str(options.seed).split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2 ** 31) : undefined;
  const out = seededShuffle(items, seed);
  return textOutput(out.join("\n"), out, { Items: String(out.length) });
};

export const rotateList: TextProcessor = async (input, { options }) => {
  const items = nonEmpty(input);
  if (!items.length) throw new ProcessorError("Paste a list, one item per line");
  const n = ((Number(options.by ?? 1) % items.length) + items.length) % items.length;
  const out = str(options.direction, "up") === "down" ? [...items.slice(items.length - n), ...items.slice(0, items.length - n)] : [...items.slice(n), ...items.slice(0, n)];
  return textOutput(out.join("\n"), out, { Items: String(out.length) });
};

export const groupItems: TextProcessor = async (input, { options }) => {
  const items = nonEmpty(input).map((l) => l.trim());
  if (!items.length) throw new ProcessorError("Paste a list, one item per line");
  const mode = str(options.mode, "size");
  const groups: string[][] = [];
  if (mode === "size") { const n = Math.max(1, Number(options.size ?? 5)); for (let i = 0; i < items.length; i += n) groups.push(items.slice(i, i + n)); }
  else if (mode === "count") { const n = Math.max(1, Number(options.size ?? 3)); for (let g = 0; g < n; g++) groups.push([]); items.forEach((it, i) => groups[i % n].push(it)); }
  else if (mode === "letter") { const m = new Map<string, string[]>(); for (const it of items) { const k = (it[0] ?? "").toUpperCase() || "#"; m.set(k, [...(m.get(k) ?? []), it]); } for (const k of [...m.keys()].sort()) groups.push([`${k}:`, ...m.get(k)!]); }
  else { const sep = str(options.separator, ":"); const m = new Map<string, string[]>(); for (const it of items) { const i = it.indexOf(sep); const k = i >= 0 ? it.slice(0, i).trim() : "(no key)"; m.set(k, [...(m.get(k) ?? []), i >= 0 ? it.slice(i + sep.length).trim() : it]); } for (const [k, v] of m) groups.push([`${k}:`, ...v]); }
  const text = groups.map((g, i) => (mode === "letter" || mode === "key" ? g.join("\n") : `Group ${i + 1}\n${g.join("\n")}`)).join("\n\n");
  return textOutput(text, groups, { Groups: String(groups.length), Items: String(items.length) });
};

export const wordFrequency: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "words");
  const ci = options.caseSensitive !== true;
  const items = mode === "lines" ? nonEmpty(input).map((l) => l.trim()) : (input.match(/[\p{L}\p{N}'’-]+/gu) ?? []);
  const minLen = Number(options.minLength ?? (mode === "lines" ? 1 : 3));
  const freq = new Map<string, number>();
  for (const raw of items) { const k = ci ? raw.toLowerCase() : raw; if (k.length < minLen) continue; freq.set(k, (freq.get(k) ?? 0) + 1); }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.max(1, Number(options.top ?? 50)));
  if (!top.length) throw new ProcessorError("Nothing to count");
  const total = items.length;
  const rows = top.map(([w, n]) => [w, n, `${((n / total) * 100).toFixed(1)}%`]);
  return { ...textOutput(rows.map((r) => `${r[1]}\t${r[0]}\t${r[2]}`).join("\n")), data: { header: ["Item", "Count", "Share"], rows }, stats: { Total: String(total), Unique: String(freq.size) } };
};

export const truncateLines: TextProcessor = async (input, { options }) => {
  const n = Math.max(1, Number(options.length ?? 80));
  const side = str(options.side, "end");
  const ell = options.ellipsis === false ? "" : "…";
  const out = lines(input).map((l) => (l.length <= n ? l : side === "start" ? ell + l.slice(l.length - n) : l.slice(0, n) + ell));
  return textOutput(out.join("\n"), undefined, { Lines: String(out.length), "Max length": String(n) });
};

export const truncateList: TextProcessor = async (input, { options }) => {
  const items = nonEmpty(input);
  const n = Math.max(0, Number(options.count ?? 10));
  const out = str(options.side, "first") === "last" ? items.slice(-n) : items.slice(0, n);
  return textOutput(out.join("\n"), out, { Kept: String(out.length), Dropped: String(items.length - out.length) });
};

export const randomizeCase: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "random");
  let i = 0;
  const out = [...input].map((ch) => { if (!/\p{L}/u.test(ch)) return ch; const up = mode === "alternate" ? i++ % 2 === 0 : Math.random() < 0.5; return up ? ch.toUpperCase() : ch.toLowerCase(); }).join("");
  return textOutput(out);
};

export const slug: TextProcessor = async (input, { options }) => {
  const sep = str(options.separator, "-");
  const keepCase = Boolean(options.keepCase);
  const make = (s: string) => {
    let t = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, sep).replace(new RegExp(`^${escapeRe(sep)}+|${escapeRe(sep)}+$`, "g"), "");
    if (!keepCase) t = t.toLowerCase();
    const max = Number(options.maxLength ?? 0);
    return max > 0 ? t.slice(0, max).replace(new RegExp(`${escapeRe(sep)}+$`), "") : t;
  };
  const out = (options.perLine === false ? [input] : nonEmpty(input)).map(make);
  return textOutput(out.join("\n"), out, { Slugs: String(out.length) });
};

export const textToTable: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "auto");
  const rowsIn = nonEmpty(input);
  if (!rowsIn.length) throw new ProcessorError("Paste some rows");
  const detect = (l: string) => (l.includes("\t") ? "\t" : l.includes("|") ? "|" : /\s{2,}/.test(l) ? "  " : l.includes(",") ? "," : /\s/.test(l) ? " " : "\t");
  const sep = mode === "auto" ? detect(rowsIn[0]) : mode === "tab" ? "\t" : mode === "comma" ? "," : mode === "pipe" ? "|" : mode === "spaces" ? "  " : " ";
  const rows = rowsIn.map((l) => (sep === "  " ? l.trim().split(/\s{2,}/) : sep === " " ? l.trim().split(/\s+/) : l.split(sep).map((c) => c.trim())).filter((c, i, a) => !(sep === "|" && (i === 0 || i === a.length - 1) && c === "")));
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  const body = norm.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  const out = str(options.output, "markdown");
  let text: string;
  if (out === "csv") text = body.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  else if (out === "tsv") text = body.map((r) => r.join("\t")).join("\n");
  else if (out === "html") text = `<table>\n${body.map((r, i) => `  <tr>${r.map((c) => `<${i === 0 ? "th" : "td"}>${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`).join("\n")}\n</table>`;
  else if (out === "ascii") { const w = Array.from({ length: cols }, (_, i) => Math.max(...body.map((r) => r[i].length))); const line = `+${w.map((x) => "-".repeat(x + 2)).join("+")}+`; text = [line, ...body.flatMap((r, i) => [`|${r.map((c, j) => ` ${c.padEnd(w[j])} `).join("|")}|`, ...(i === 0 ? [line] : [])]), line].join("\n"); }
  else { const w = Array.from({ length: cols }, (_, i) => Math.max(3, ...body.map((r) => r[i].length))); text = [`| ${body[0].map((c, j) => c.padEnd(w[j])).join(" | ")} |`, `| ${w.map((x) => "-".repeat(x)).join(" | ")} |`, ...body.slice(1).map((r) => `| ${r.map((c, j) => c.padEnd(w[j])).join(" | ")} |`)].join("\n"); }
  return { ...textOutput(text), data: { header: body[0], rows: body.slice(1) }, stats: { Rows: String(body.length), Columns: String(cols) } };
};

export const censor: TextProcessor = async (input, { options }) => {
  const words = str(options.words).split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
  if (!words.length) throw new ProcessorError("Enter the words to censor, comma separated");
  const mask = str(options.mask, "*");
  const keepFirst = Boolean(options.keepFirst);
  const re = new RegExp(`\\b(${words.map(escapeRe).join("|")})\\b`, options.caseSensitive ? "g" : "gi");
  let n = 0;
  const out = input.replace(re, (m) => { n++; return keepFirst ? m[0] + mask.repeat(Math.max(1, m.length - 1)) : mask.repeat(m.length); });
  return textOutput(out, undefined, { Censored: String(n) });
};

export const rot13: TextProcessor = async (input, { options }) => {
  const shift = ((Number(options.shift ?? 13) % 26) + 26) % 26;
  const out = input.replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + shift) % 26) + b); });
  return textOutput(out, undefined, { Shift: String(shift) });
};
