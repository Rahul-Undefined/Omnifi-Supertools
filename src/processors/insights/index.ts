import type { CalcProcessor, TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { formatNumber } from "@/lib/utils";
import { textOutput, fileFromText, fileFromBytes } from "../shared/output";
import { PdfWriter, NAVY, MUTED, resetStripped } from "../shared/pdfwriter";
import { csvFile } from "../shared/table";
import { aiSignals } from "./ai-signals";
import { readabilityReport } from "./readability";
import { similarityReport } from "./similarity";
import { passwordStrength, generatePassword } from "./password";
import { cleanEmails } from "./emails";
import { generateRows, type DummyKind } from "./dummy";

const rows = (r: [string, string][]) => r.map(([k, v]) => `${k}: ${v}`).join("\n");

export const aiWriting: TextProcessor = async (input) => {
  if (input.trim().split(/\s+/).length < 60) throw new ProcessorError("Paste at least 60 words", "Shorter texts do not carry enough signal for a fair reading.");
  const r = aiSignals(input);
  const lines: [string, string][] = [["Overall", `${r.label} (${r.score}/100)`], ...r.signals.map((s) => [s.name, `${s.verdict} · ${s.detail}`] as [string, string])];
  const text = `${rows(lines)}\n\n${r.note}`;
  return textOutput(text, r, { Score: `${r.score}/100`, Reading: r.label, Words: String(r.words) });
};

export const readability: TextProcessor = async (input, { options }) => {
  if (!input.trim()) throw new ProcessorError("Paste some text first");
  const r = readabilityReport(input, Boolean(options.brandVoice ?? true));
  const lines: [string, string][] = [
    ["Flesch reading ease", `${r.fleschEase} (${r.easeLabel})`],
    ["Grade level", `${r.grade} (${r.gradeLabel})`],
    ["Average sentence length", `${r.avgSentence} words`],
    ["Long sentences (25+ words)", String(r.longSentences)],
    ["Passive voice", `${r.passive} sentence${r.passive === 1 ? "" : "s"}`],
    ["Adverbs ending in -ly", String(r.adverbs)],
    ["Reading time", r.readingTime],
  ];
  const brand = r.brandHits.length ? `\n\nOmnifi voice check: avoid ${r.brandHits.map((h) => `"${h.word}" (${h.count}×)`).join(", ")}.` : options.brandVoice === false ? "" : "\n\nOmnifi voice check: no forbidden words found.";
  const tips = r.tips.length ? `\n\nSuggestions:\n- ${r.tips.join("\n- ")}` : "";
  return textOutput(rows(lines) + brand + tips, r, { Ease: String(r.fleschEase), Grade: String(r.grade), "Brand issues": String(r.brandHits.length) });
};

export const similarity: TextProcessor = async (input, { options }) => {
  const b = String(options.b ?? "");
  if (!input.trim() || !b.trim()) throw new ProcessorError("Paste both texts");
  const r = similarityReport(input, b);
  const lines: [string, string][] = [["Overall similarity", `${r.overall}%`], ["Shared 5-word phrases", String(r.sharedShingles)], ["Word overlap (Jaccard)", `${r.jaccard}%`], ["Longest shared passage", `${r.longest.length} words`]];
  const passages = r.passages.length ? `\n\nShared passages:\n${r.passages.map((p) => `- "${p}"`).join("\n")}` : "";
  return textOutput(rows(lines) + passages, r, { Similarity: `${r.overall}%`, "Shared phrases": String(r.sharedShingles) });
};

export const password: CalcProcessor = async ({ options }) => {
  const mode = String(options.mode ?? "generate");
  if (mode === "check") {
    const pw = String(options.password ?? "");
    if (!pw) throw new ProcessorError("Enter a password to check");
    const r = passwordStrength(pw);
    const lines: [string, string][] = [["Strength", `${r.label} (${r.score}/4)`], ["Entropy", `${r.entropy} bits`], ["Time to crack (offline, fast GPU)", r.crackTime], ["Length", String(pw.length)]];
    return textOutput(rows(lines) + (r.warnings.length ? `\n\nWarnings:\n- ${r.warnings.join("\n- ")}` : ""), r, { Strength: r.label, Entropy: `${r.entropy} bits` });
  }
  const count = Math.min(50, Math.max(1, Number(options.count ?? 5)));
  const length = Math.min(128, Math.max(8, Number(options.length ?? 20)));
  const list = Array.from({ length: count }, () => generatePassword(length, { symbols: options.symbols !== false, digits: options.digits !== false, passphrase: String(options.style ?? "random") === "passphrase" }));
  const strength = passwordStrength(list[0]);
  return textOutput(list.join("\n"), list, { Length: String(length), Strength: strength.label, Entropy: `${strength.entropy} bits` });
};

export const emailClean: TextProcessor = async (input, { options }) => {
  const r = cleanEmails(input, { dropRoles: Boolean(options.dropRoles), dropDisposable: options.dropDisposable !== false });
  if (!r.valid.length && !r.invalid.length) throw new ProcessorError("No email addresses found");
  const text = r.valid.join("\n");
  const stats = { Valid: String(r.valid.length), Invalid: String(r.invalid.length), Duplicates: String(r.duplicates), Removed: String(r.roles + r.disposable) };
  const report = `${text}${r.invalid.length ? `\n\n# Invalid (${r.invalid.length})\n${r.invalid.join("\n")}` : ""}${r.removed.length ? `\n\n# Removed role/disposable (${r.removed.length})\n${r.removed.join("\n")}` : ""}`;
  return { files: [fileFromText("emails-clean.txt", text), csvFile("emails-report.csv", [["Email", "Status"], ...r.valid.map((e) => [e, "valid"]), ...r.invalid.map((e) => [e, "invalid"]), ...r.removed.map((e) => [e, "removed"])])], text: report, stats };
};

export const dummyData: CalcProcessor = async ({ options }) => {
  const kind = String(options.kind ?? "people") as DummyKind;
  const count = Math.min(5000, Math.max(1, Number(options.count ?? 50)));
  const data = generateRows(kind, count, Number(options.seed ?? 0) || undefined);
  const preview = data.slice(0, 12);
  return { files: [csvFile(`test-${kind}-${count}.csv`, data)], text: preview.map((r) => r.join(", ")).join("\n") + (data.length > 12 ? `\n… ${data.length - 12} more rows in the CSV` : ""), data: { header: data[0].map(String), rows: data.slice(1, 12) }, stats: { Rows: String(count), Columns: String(data[0].length) } };
};

export const meetingCost: CalcProcessor = async ({ options }) => {
  const people = Math.max(1, Number(options.people ?? 6));
  const minutes = Math.max(1, Number(options.minutes ?? 60));
  const rate = Number(options.rate ?? 75);
  const perWeek = Math.max(0, Number(options.perWeek ?? 1));
  const cost = people * (minutes / 60) * rate;
  const lines: [string, string][] = [["Cost of this meeting", `$${formatNumber(cost, 2)}`], ["Per minute", `$${formatNumber(cost / minutes, 2)}`], ["Per year (at this cadence)", `$${formatNumber(cost * perWeek * 52, 0)}`], ["Person-hours", formatNumber((people * minutes) / 60, 1)]];
  return textOutput(rows(lines), { cost }, Object.fromEntries(lines));
};

/** Markdown → branded PDF using the same writer as the Office converters. */
export const markdownToPdf: TextProcessor = async (input, { options }) => {
  if (!input.trim()) throw new ProcessorError("Paste some Markdown first");
  resetStripped();
  const pw = await PdfWriter.create();
  const title = String(options.title ?? "").trim();
  if (title) pw.text(title, { size: 24, bold: true, color: NAVY, spaceAfter: 12 });
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let listIndex = 0;
  const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      pw.text(buf.join("\n"), { size: 9, color: MUTED, indent: 12, lineHeight: 12 });
      continue;
    }
    if (/^\|/.test(line)) {
      const tbl: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        if (!/^\|\s*:?-+/.test(lines[i])) tbl.push(lines[i].split("|").slice(1, -1).map((c) => inline(c.trim())));
        i++;
      }
      pw.table(tbl, { header: true });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { pw.text(inline(h[2]), { size: [22, 18, 15, 13, 12, 11][h[1].length - 1], bold: true, color: NAVY, spaceAfter: 6 }); listIndex = 0; i++; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)/);
    if (ul) { pw.text(`•  ${inline(ul[1])}`, { size: 11, indent: 16 }); i++; continue; }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ol) { listIndex++; pw.text(`${listIndex}.  ${inline(ol[1])}`, { size: 11, indent: 16 }); i++; continue; }
    const q = line.match(/^>\s?(.*)/);
    if (q) { pw.text(inline(q[1]), { size: 11, italic: true, color: MUTED, indent: 16 }); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { pw.space(10); i++; continue; }
    if (!line.trim()) { pw.space(4); listIndex = 0; i++; continue; }
    // Paragraph: merge consecutive text lines.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\s*[-*+]\s|\s*\d+[.)]\s|>|```|\|)/.test(lines[i])) buf.push(lines[i++]);
    pw.text(inline(buf.join(" ")), { size: 11 });
  }
  pw.footer(title || "Omnifi SuperTools");
  const bytes = await pw.save();
  return { files: [fileFromBytes(`${(title || "document").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`, bytes, "application/pdf")], stats: { Pages: String(pw.pageCount) } };
};
