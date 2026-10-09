import type { TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { textOutput } from "../shared/output";
import { diffLines, formatDiff, diffSummary } from "../shared/diff";

const linesOf = (s: string) => s.split(/\r?\n/);

export const count: TextProcessor = async (input) => {
  const words = input.trim() ? input.trim().split(/\s+/).length : 0;
  const chars = input.length;
  const charsNoSpace = input.replace(/\s/g, "").length;
  const lines = input ? linesOf(input).length : 0;
  const sentences = (input.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []).length || (input.trim() ? 1 : 0);
  const paragraphs = input.trim() ? input.trim().split(/\n\s*\n/).length : 0;
  const minutes = words / 220;
  const reading = minutes < 1 ? `${Math.max(1, Math.round(minutes * 60))} sec` : `${Math.round(minutes)} min`;
  const stats = { Words: words.toLocaleString(), Characters: chars.toLocaleString(), "Without spaces": charsNoSpace.toLocaleString(), Lines: String(lines), Sentences: String(sentences), Paragraphs: String(paragraphs), "Reading time": reading };
  const freq = new Map<string, number>();
  for (const w of input.toLowerCase().match(/[a-z0-9']+/g) ?? []) if (w.length > 3) freq.set(w, (freq.get(w) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const text = Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join("\n") + (top.length ? `\n\nMost frequent words:\n${top.map(([w, n]) => `${w} (${n})`).join("\n")}` : "");
  return textOutput(text, { ...stats, top }, stats);
};

const toWords = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").split(/\s+/).filter(Boolean);

export const caseConvert: TextProcessor = async (input, { options }) => {
  const to = String(options.to ?? "upper");
  const convert = (s: string) => {
    switch (to) {
      case "lower": return s.toLowerCase();
      case "title": return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      case "sentence": return s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
      case "camel": { const w = toWords(s).map((x) => x.toLowerCase()); return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join(""); }
      case "snake": return toWords(s).map((x) => x.toLowerCase()).join("_");
      case "kebab": return toWords(s).map((x) => x.toLowerCase()).join("-");
      default: return s.toUpperCase();
    }
  };
  const out = ["camel", "snake", "kebab"].includes(to) ? linesOf(input).map(convert).join("\n") : convert(input);
  return textOutput(out);
};
export { caseConvert as case };

export const dedupeLines: TextProcessor = async (input, { options }) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of linesOf(input)) {
    const line = options.trim !== false ? raw.trim() : raw;
    const key = options.caseInsensitive ? line.toLowerCase() : line;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  const removed = linesOf(input).length - out.length;
  return textOutput(out.join("\n"), undefined, { Kept: String(out.length), Removed: String(removed) });
};

export const sortLines: TextProcessor = async (input, { options }) => {
  const by = String(options.by ?? "alpha");
  const ci = options.caseInsensitive !== false;
  const lines = linesOf(input).filter((l, i, a) => !(i === a.length - 1 && l === ""));
  const collator = new Intl.Collator(undefined, { numeric: by === "natural", sensitivity: ci ? "base" : "variant" });
  lines.sort((a, b) => (by === "length" ? a.length - b.length || collator.compare(a, b) : collator.compare(a, b)));
  if (options.desc) lines.reverse();
  return textOutput(lines.join("\n"), undefined, { Lines: String(lines.length) });
};

export const reverse: TextProcessor = async (input, { options }) => {
  const lines = linesOf(input);
  const out = String(options.mode ?? "lines") === "chars" ? lines.map((l) => [...l].reverse().join("")) : lines.reverse();
  return textOutput(out.join("\n"));
};

export const diff: TextProcessor = async (input, { options }) => {
  const b = String(options.b ?? "");
  if (!input && !b) throw new ProcessorError("Enter both texts to compare");
  const ops = diffLines(input, b);
  const s = diffSummary(ops);
  return textOutput(formatDiff(ops), ops, { Added: String(s.added), Removed: String(s.removed), Unchanged: String(s.unchanged) });
};

export const clean: TextProcessor = async (input, { options }) => {
  let s = input.replace(/\r\n/g, "\n");
  if (options.smartQuotes !== false) s = s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/–|—/g, "-").replace(/…/g, "...");
  if (options.nonPrintable !== false) s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍﻿]/g, "");
  if (options.collapseSpaces !== false) s = s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "");
  if (options.blankLines !== false) s = s.replace(/\n{2,}/g, "\n");
  return textOutput(s.trim(), undefined, { Original: `${input.length} chars`, Output: `${s.trim().length} chars` });
};

export const whitespace: TextProcessor = async (input, { options }) => {
  const mode = String(options.mode ?? "trim");
  const lines = linesOf(input);
  const out = mode === "all" ? input.replace(/\s+/g, "") : mode === "leading" ? lines.map((l) => l.replace(/^\s+/, "")).join("\n") : mode === "trailing" ? lines.map((l) => l.replace(/\s+$/, "")).join("\n") : lines.map((l) => l.trim()).join("\n");
  return textOutput(out);
};

export const markdownFormat: TextProcessor = async (input) => {
  const out = input
    .replace(/\r\n/g, "\n")
    .replace(/^(#+)([^\s#])/gm, "$1 $2")
    .replace(/^\s*[*+]\s+/gm, "- ")
    .replace(/^(\s*)(\d+)\)\s+/gm, "$1$2. ")
    .replace(/[ \t]+$/gm, "")
    .replace(/^(#+ .*)\n(?!\n)/gm, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
  return textOutput(out);
};

export const htmlToMarkdown: TextProcessor = async (input) => {
  let s = input.replace(/\r\n/g, "\n");
  s = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "");
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n${"#".repeat(Number(n))} ${strip(t)}\n\n`);
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${strip(t)}\n\`\`\`\n`);
  s = s.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `[${strip(t)}](${h})`);
  s = s.replace(/<img\s[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, "![$1]($2)").replace(/<img\s[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "![$2]($1)").replace(/<img\s[^>]*src=["']([^"']*)["'][^>]*>/gi, "![]($1)");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${strip(t)}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => strip(t).split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, (_, t) => (t.toLowerCase() === "hr" ? "\n---\n" : "\n"));
  s = s.replace(/<\/(p|div|tr|table|ul|ol)>/gi, "\n\n");
  s = s.replace(/<\/t[dh]>/gi, " | ");
  s = strip(s);
  return textOutput(s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
};

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
