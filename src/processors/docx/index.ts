import type JSZip from "jszip";
import type { FileProcessor, TextProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import {
  openPackage, readPart, writePart, savePackage, clonePackage, readRels, relsPathFor, resolveTarget, parseRels, addRel, nextRelId,
  REL, CT_PATH, ctAddOverride, ctRemoveOverride, paragraphText, splitParagraphs, replaceInXml, replaceFont, replaceColor, cleanMetadata,
  mediaParts, extOf, imagesOfPart, fontsUsed, wordCount, xmlEncode, MIME, escapeRe,
} from "../shared/ooxml";
import { DocxWriter, type Inline } from "../shared/docxwriter";
import { fileFromText } from "../shared/output";
import { zipFiles, maybeZip } from "../shared/zip";
import { readSheets, xlsxFile, cellText, type Row, type Sheet } from "../shared/table";
import { diffLines, diffSummary } from "../shared/diff";
import { recompressMedia, checkLinks, collectLinks } from "../pptx";

export { mergeDocs } from "./merge";

/* ---------- Reading ---------- */

export interface Block { kind: "p" | "table"; text: string; style: string; level: number; list: boolean; numbered: boolean; rows?: string[][]; xml: string; pageBreak: boolean }

const BODY_RE = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g;

/** Body of a document split into paragraphs and tables, with heading levels. */
export function parseBody(xml: string): Block[] {
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const blocks: Block[] = [];
  for (const m of body.matchAll(BODY_RE)) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl")) {
      const rows = [...chunk.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p\b(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((p) => paragraphText(p[0], "w")).join(" ").trim()));
      blocks.push({ kind: "table", text: rows.map((r) => r.join("\t")).join("\n"), style: "", level: 0, list: false, numbered: false, rows, xml: chunk, pageBreak: false });
      continue;
    }
    const style = chunk.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const hm = style.match(/^(?:Heading|heading|Titre|berschrift)?(\d)$/) ?? style.match(/^Heading(\d)/i);
    const outline = chunk.match(/<w:outlineLvl w:val="(\d)"/)?.[1];
    const level = hm ? Number(hm[1]) : outline ? Number(outline) + 1 : /^Title$/i.test(style) ? 0 : 99;
    const list = /<w:numPr>/.test(chunk);
    const ilvl = Number(chunk.match(/<w:ilvl w:val="(\d)"/)?.[1] ?? 0);
    blocks.push({ kind: "p", text: paragraphText(chunk, "w"), style, level: list ? ilvl : level, list, numbered: list && /ListNumber|Number/i.test(style), xml: chunk, pageBreak: /<w:br w:type="page"\/>|<w:pageBreakBefore\/>/.test(chunk) });
  }
  return blocks;
}

/** Parts that carry body text: document, headers, footers, footnotes, endnotes (+ comments optionally). */
export async function textParts(zip: JSZip, opts: { comments?: boolean } = {}): Promise<string[]> {
  const parts = ["word/document.xml"];
  for (const r of await readRels(zip, "word/document.xml")) {
    if (r.external) continue;
    if (/\/(header|footer|footnotes|endnotes)$/.test(r.type) || (opts.comments && /\/comments$/.test(r.type))) parts.push(resolveTarget("word/document.xml", r.target));
  }
  return parts.filter((p) => zip.file(p));
}

async function withDoc(files: File[], onProgress: ((f: number, l?: string) => void) | undefined, signal: AbortSignal | undefined, fn: (file: File, zip: JSZip, docXml: string) => Promise<ProcessorFile | ProcessorFile[]>) {
  const out: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "docx");
    const r = await fn(files[i], zip, (await readPart(zip, "word/document.xml")) ?? "");
    out.push(...(Array.isArray(r) ? r : [r]));
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return out;
}

/* ---------- 1. Text / Markdown extractor, 16. tables to Excel ---------- */

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let num = 0;
  for (const b of blocks) {
    if (b.kind === "table" && b.rows?.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${Array.from({ length: cols }, (_, i) => esc(b.rows![0][i] ?? "")).join(" | ")} |`, `| ${Array(cols).fill("---").join(" | ")} |`);
      for (const r of b.rows.slice(1)) out.push(`| ${Array.from({ length: cols }, (_, i) => esc(r[i] ?? "")).join(" | ")} |`);
      out.push("");
      continue;
    }
    if (!b.text.trim()) { num = 0; continue; }
    if (b.level === 0 && b.style === "Title") out.push(`# ${b.text}`, "");
    else if (b.level >= 1 && b.level <= 6) { out.push(`${"#".repeat(Math.min(6, b.level + 1))} ${b.text}`, ""); num = 0; }
    else if (b.list) { out.push(`${"  ".repeat(b.level)}${b.numbered ? `${++num}.` : "-"} ${b.text}`); }
    else { out.push(b.text, ""); num = 0; }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const extractText: FileProcessor = async (files, { options, onProgress, signal }) => {
  const format = String(options.format ?? "txt");
  let words = 0; let preview = "";
  const outputs = await withDoc(files, onProgress, signal, async (file, zip, docXml) => {
    const blocks = parseBody(docXml);
    const text = format === "md" ? blocksToMarkdown(blocks) : blocks.map((b) => (b.kind === "table" ? b.rows!.map((r) => r.join("\t")).join("\n") : b.text)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const extra: string[] = [];
    if (options.headers) {
      for (const p of (await textParts(zip)).filter((x) => /header|footer/.test(x))) {
        const t = parseBody(`<w:body>${(await readPart(zip, p)) ?? ""}</w:body>`).map((b) => b.text).filter((x) => x.trim()).join(" | ");
        if (t) extra.push(`[${/header/.test(p) ? "Header" : "Footer"}] ${t}`);
      }
    }
    const full = [text, ...extra].join("\n\n");
    words += wordCount(full);
    if (!preview) preview = full;
    return fileFromText(`${baseName(file.name)}.${format === "md" ? "md" : "txt"}`, full, format === "md" ? "text/markdown" : "text/plain");
  });
  return { files: await maybeZip(outputs, "document-text.zip"), text: files.length === 1 ? preview : undefined, stats: { Words: words.toLocaleString() } };
};

export const tablesToExcel: FileProcessor = async (files, { onProgress, signal }) => {
  let count = 0;
  const outputs = await withDoc(files, onProgress, signal, async (file, _zip, docXml) => {
    const tables = parseBody(docXml).filter((b) => b.kind === "table" && b.rows?.length);
    if (!tables.length) throw new ProcessorError(`${file.name} has no tables`);
    count += tables.length;
    const sheets: Sheet[] = tables.map((t, i) => ({ name: `Table ${i + 1}`, rows: t.rows!.map((r) => r.map((c) => (/^-?[\d,]+(\.\d+)?$/.test(c.trim()) ? Number(c.replace(/,/g, "")) : c))) }));
    return xlsxFile(`${baseName(file.name)}-tables.xlsx`, sheets);
  });
  return { files: await maybeZip(outputs, "tables.zip"), stats: { Tables: String(count) } };
};

/* ---------- 2. Images ---------- */

export const extractImages: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "docx");
    const seen = new Set<string>();
    for (const p of mediaParts(zip, "word/media").filter((x) => /^(png|jpe?g|gif|bmp|tiff?|webp|svg|emf|wmf)$/.test(extOf(x)))) {
      const bytes = await zip.file(p)!.async("uint8array");
      const key = `${bytes.length}:${bytes.slice(0, 64).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      outputs.push({ name: files.length > 1 ? `${baseName(files[i].name)}/${p.slice("word/media/".length)}` : p.slice("word/media/".length), blob: new Blob([bytes as BlobPart]), bytes: bytes.length });
    }
    onProgress?.((i + 1) / files.length);
  }
  if (!outputs.length) throw new ProcessorError("No pictures found in the document(s)");
  return { files: [await zipFiles(outputs, files.length === 1 ? `${baseName(files[0].name)}-images.zip` : "document-images.zip", 0)], stats: { Images: String(outputs.length), Size: formatBytes(outputs.reduce((a, f) => a + f.bytes, 0)) } };
};

/* ---------- 4. Split ---------- */

export const splitDoc: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "heading");
  const level = Number(options.level ?? 1);
  let produced = 0;
  const outputs = await withDoc(files, onProgress, signal, async (file, zip, docXml) => {
    const bodyInner = docXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? "";
    const sectIdx = bodyInner.lastIndexOf("<w:sectPr");
    const content = sectIdx >= 0 ? bodyInner.slice(0, sectIdx) : bodyInner;
    const sectPr = sectIdx >= 0 ? bodyInner.slice(sectIdx) : "";
    const blocks = parseBody(`<w:body>${content}</w:body>`);
    const groups: { title: string; xml: string[] }[] = [];
    let cur: { title: string; xml: string[] } | null = null;
    for (const b of blocks) {
      const starts = mode === "heading" ? b.kind === "p" && b.level >= 1 && b.level <= level && b.text.trim() : b.pageBreak;
      if (starts || !cur) { if (cur && (cur.xml.length || cur.title)) groups.push(cur); cur = { title: mode === "heading" ? b.text.trim() : `part-${groups.length + 1}`, xml: [] }; }
      cur.xml.push(b.xml);
    }
    if (cur) groups.push(cur);
    if (groups.length < 2) throw new ProcessorError(mode === "heading" ? `No Heading ${level} paragraphs found to split on` : "No page breaks found", mode === "heading" ? "Use Word's Heading styles for section titles, or split by page breaks." : undefined);
    const outs: ProcessorFile[] = [];
    for (let g = 0; g < groups.length; g++) {
      throwIfAborted(signal);
      const part = await clonePackage(zip);
      writePart(part, "word/document.xml", docXml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${groups[g].xml.join("")}${sectPr}</w:body>`));
      const safe = (groups[g].title || `part-${g + 1}`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
      outs.push(await savePackage(part, `${baseName(file.name)} - ${String(g + 1).padStart(2, "0")} ${safe}.docx`, MIME.docx));
      produced++;
    }
    return outs;
  });
  return { files: await maybeZip(outputs, "split-documents.zip"), stats: { Documents: String(produced) } };
};

/* ---------- 5. Find & replace, 6. Fonts & colours ---------- */

function parsePairs(input: string): [string, string][] {
  return input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)\s*(?:=>|->|→|\t)\s*(.*)$/); return m ? [m[1], m[2]] : [l, ""]; });
}

export const findReplace: FileProcessor = async (files, { options, onProgress, signal }) => {
  const pairs = String(options.pairs ?? "").trim() ? parsePairs(String(options.pairs)) : [[String(options.find ?? ""), String(options.replace ?? "")] as [string, string]];
  if (!pairs.some(([f]) => f)) throw new ProcessorError("Enter the text to find", "Example: Acme Corp => Omnifi");
  const ro = { regex: Boolean(options.regex), caseSensitive: Boolean(options.caseSensitive), wholeWord: Boolean(options.wholeWord) };
  let total = 0;
  const outputs = await withDoc(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    for (const p of await textParts(out, { comments: Boolean(options.comments) })) {
      let xml = (await readPart(out, p)) ?? "";
      for (const [f, r] of pairs) { if (!f) continue; const res = replaceInXml(xml, "w", f, r, ro); xml = res.xml; total += res.count; }
      writePart(out, p, xml);
    }
    return savePackage(out, `${baseName(file.name)}-replaced.docx`, MIME.docx);
  });
  return { files: await maybeZip(outputs, "replaced-documents.zip"), stats: { Replacements: String(total) }, warnings: total === 0 ? ["Nothing matched. Check spelling and case; text inside pictures or text boxes drawn as shapes cannot be edited."] : [] };
};

export const fontColor: FileProcessor = async (files, { options, onProgress, signal }) => {
  const fontFrom = String(options.fontFrom ?? "").trim(), fontTo = String(options.fontTo ?? "").trim();
  const colorFrom = String(options.colorFrom ?? "").trim(), colorTo = String(options.colorTo ?? "").trim();
  if (!(fontFrom && fontTo) && !(colorFrom && colorTo)) throw new ProcessorError("Enter a font pair and/or a colour pair");
  let fonts = 0, colors = 0;
  const outputs = await withDoc(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    const parts = [...(await textParts(out, { comments: true })), "word/styles.xml", "word/numbering.xml", "word/theme/theme1.xml"].filter((p) => out.file(p));
    for (const p of parts) {
      let xml = (await readPart(out, p)) ?? "";
      if (fontFrom && fontTo) { const r = replaceFont(xml, fontFrom, fontTo); xml = r.xml; fonts += r.count; }
      if (colorFrom && colorTo) { const r = replaceColor(xml, colorFrom, colorTo); xml = r.xml; colors += r.count; }
      writePart(out, p, xml);
    }
    return savePackage(out, `${baseName(file.name)}-restyled.docx`, MIME.docx);
  });
  return { files: await maybeZip(outputs, "restyled-documents.zip"), stats: { "Font changes": String(fonts), "Colour changes": String(colors) }, warnings: fonts + colors === 0 ? ["Nothing matched. Font names must match exactly (e.g. 'Calibri'); the document default font lives in styles.xml which is included."] : [] };
};

/* ---------- 7. Clean copy / accept changes ---------- */

export function acceptAllChanges(xml: string): { xml: string; count: number } {
  let count = 0;
  const strip = (re: RegExp, keepInner = false) => { xml = xml.replace(re, (m, inner) => { count++; return keepInner ? inner ?? "" : ""; }); };
  strip(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g);
  strip(/<w:moveFrom\b[^>]*>([\s\S]*?)<\/w:moveFrom>/g);
  strip(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, true);
  strip(/<w:moveTo\b[^>]*>([\s\S]*?)<\/w:moveTo>/g, true);
  for (const tag of ["rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "numberingChange", "tblPrExChange"]) strip(new RegExp(`<w:${tag}\\b[^>]*>[\\s\\S]*?</w:${tag}>`, "g"));
  strip(/<w:(?:ins|del|moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd|cellIns|cellDel|cellMerge)\b[^>]*\/>/g);
  return { xml, count };
}

export function stripComments(xml: string): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(/<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>/g, () => { count++; return ""; }).replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>[\s\S]*?<\/w:r>/g, "");
  return { xml: out, count: Math.ceil(count / 2) };
}

export function stripHidden(xml: string): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => (/<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*?<w:vanish\/>/.test(run) ? (count++, "") : run));
  return { xml: out, count };
}

export const cleanCopy: FileProcessor = async (files, { options, onProgress, signal }) => {
  const report: string[] = [];
  const outputs = await withDoc(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    const done: string[] = [];
    let changes = 0, comments = 0, hidden = 0;
    for (const p of await textParts(out)) {
      let xml = (await readPart(out, p)) ?? "";
      if (options.changes !== false) { const r = acceptAllChanges(xml); xml = r.xml; changes += r.count; }
      if (options.comments !== false) { const r = stripComments(xml); xml = r.xml; comments += r.count; }
      if (options.hidden) { const r = stripHidden(xml); xml = r.xml; hidden += r.count; }
      writePart(out, p, xml);
    }
    if (options.comments !== false) {
      let ct = (await readPart(out, CT_PATH))!;
      let rels = (await readPart(out, relsPathFor("word/document.xml")))!;
      for (const r of parseRels(rels)) if (/\/(comments|commentsExtended|commentsIds|commentsExtensible|people)$/.test(r.type)) { const t = resolveTarget("word/document.xml", r.target); out.remove(t); out.remove(relsPathFor(t)); ct = ctRemoveOverride(ct, t); rels = rels.replace(r.raw, ""); }
      writePart(out, CT_PATH, ct); writePart(out, relsPathFor("word/document.xml"), rels);
    }
    if (options.changes !== false) {
      const settings = await readPart(out, "word/settings.xml");
      if (settings) writePart(out, "word/settings.xml", settings.replace(/<w:trackRevisions\b[^>]*\/>/g, ""));
    }
    if (changes) done.push(`${changes} tracked change(s) accepted`);
    if (comments) done.push(`${comments} comment(s) removed`);
    if (hidden) done.push(`${hidden} hidden run(s) removed`);
    if (options.metadata !== false) { const removed = await cleanMetadata(out, { keepTitle: true }); if (removed.length) done.push(`metadata cleared (${removed.join(", ")})`); }
    report.push(`${file.name}: ${done.length ? done.join("; ") : "nothing to clean"}`);
    return savePackage(out, `${baseName(file.name)}-clean.docx`, MIME.docx);
  });
  return { files: await maybeZip(outputs, "clean-documents.zip"), text: report.join("\n"), stats: { Documents: String(files.length) } };
};

export const acceptChanges: FileProcessor = async (files, { onProgress, signal }) => {
  let total = 0;
  const outputs = await withDoc(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    for (const p of await textParts(out)) { const r = acceptAllChanges((await readPart(out, p)) ?? ""); total += r.count; writePart(out, p, r.xml); }
    const settings = await readPart(out, "word/settings.xml");
    if (settings) writePart(out, "word/settings.xml", settings.replace(/<w:trackRevisions\b[^>]*\/>/g, ""));
    return savePackage(out, `${baseName(file.name)}-final.docx`, MIME.docx);
  });
  return { files: await maybeZip(outputs, "final-documents.zip"), stats: { "Changes accepted": String(total) }, warnings: total === 0 ? ["No tracked changes were found."] : [] };
};

/* ---------- 8. Compress, 9. Links ---------- */

export const compress: FileProcessor = async (files, { options, onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  let before = 0, after = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "docx");
    await recompressMedia(zip, "word/media", Number(options.maxPx ?? 1600), Number(options.quality ?? 0.8), (f) => onProgress?.((i + f) / files.length));
    const saved = await savePackage(zip, `${baseName(files[i].name)}-compressed.docx`, MIME.docx);
    before += files[i].size; after += saved.bytes; outputs.push(saved);
  }
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  return { files: await maybeZip(outputs, "compressed-documents.zip"), stats: { Before: formatBytes(before), After: formatBytes(after), Saved: `${Math.max(0, pct)}%` }, warnings: pct < 5 ? ["Little to gain: few large pictures, or they are already compressed."] : [] };
};

export const linkCheck: FileProcessor = async (files, { onProgress, signal }) => {
  const rows: Row[] = [["Document", "Where", "Link", "Status", "Final URL"]];
  let broken = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "docx");
    const parts = await textParts(zip);
    const links = await collectLinks(zip, parts);
    const results = await checkLinks(links.map((l) => l.url), (f) => onProgress?.((i + f) / files.length));
    for (const l of links) { const r = results.get(l.url)!; if (!r.ok) broken++; rows.push([files[i].name, l.part.replace("word/", "").replace(".xml", ""), l.url, String(r.status), r.finalUrl && r.finalUrl !== l.url ? r.finalUrl : ""]); }
  }
  if (rows.length === 1) throw new ProcessorError("No hyperlinks found");
  return { files: [xlsxFile("link-check.xlsx", [{ name: "Links", rows }])], text: rows.slice(1).map((r) => `${r[3]}  ${r[2]}`).join("\n"), data: { header: rows[0] as string[], rows: rows.slice(1) as (string | number)[][] }, stats: { Links: String(rows.length - 1), Broken: String(broken) } };
};

/* ---------- 10. Markdown, 11. Spreadsheet, 12. Mail merge ---------- */

type MdToken = { type: string; depth?: number; text?: string; tokens?: MdToken[]; items?: { text: string; tokens?: MdToken[] }[]; header?: { text: string }[]; rows?: { text: string }[][]; raw?: string; ordered?: boolean; lang?: string; href?: string };

function inlines(tokens: MdToken[] | undefined, text: string | undefined): Inline[] {
  if (!tokens?.length) return [{ text: (text ?? "").replace(/\*\*|__|~~/g, "") }];
  const out: Inline[] = [];
  const walk = (ts: MdToken[], ctx: Partial<Inline>) => {
    for (const t of ts) {
      if (t.type === "strong") walk(t.tokens ?? [], { ...ctx, bold: true });
      else if (t.type === "em") walk(t.tokens ?? [], { ...ctx, italic: true });
      else if (t.type === "codespan") out.push({ ...ctx, text: t.text ?? "", code: true });
      else if (t.type === "link") walk(t.tokens ?? [{ type: "text", text: t.text }], { ...ctx, link: t.href });
      else if (t.type === "br") out.push({ ...ctx, text: "\n" });
      else if (t.tokens?.length) walk(t.tokens, ctx);
      else if (t.type !== "image") out.push({ ...ctx, text: (t.text ?? t.raw ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") });
    }
  };
  walk(tokens, {});
  return out.length ? out : [{ text: text ?? "" }];
}

export const fromMarkdown: TextProcessor = async (input, { options }) => {
  const { marked } = await import("marked");
  const tokens = marked.lexer(input) as unknown as MdToken[];
  if (!tokens.length) throw new ProcessorError("Paste some Markdown first");
  const title = String(options.title ?? "").trim() || (tokens.find((t) => t.type === "heading" && t.depth === 1)?.text ?? "Document");
  const d = new DocxWriter(title, String(options.font ?? "Calibri"));
  const render = (ts: MdToken[]) => {
    for (const t of ts) {
      if (t.type === "heading") { if (t.depth === 1 && !d["body"].length) d.para(inlines(t.tokens, t.text), { style: "Title" }); else d.heading(inlines(t.tokens, t.text).map((x) => x.text).join(""), Math.min(4, Math.max(1, (t.depth ?? 2) - (ts.some((x) => x.type === "heading" && x.depth === 1) ? 1 : 0))) as 1 | 2 | 3 | 4); }
      else if (t.type === "paragraph") d.para(inlines(t.tokens, t.text));
      else if (t.type === "list") {
        const items: { parts: Inline[]; level: number }[] = [];
        const walk = (its: NonNullable<MdToken["items"]>, level: number) => { for (const it of its) { const first = it.tokens?.find((x) => x.type === "text" || x.type === "paragraph"); items.push({ parts: inlines(first?.tokens, first?.text ?? it.text), level }); const sub = it.tokens?.find((x) => x.type === "list"); if (sub?.items) walk(sub.items, level + 1); } };
        walk(t.items ?? [], 0);
        d.bullets(items, Boolean(t.ordered));
      }
      else if (t.type === "table") d.table([(t.header ?? []).map((h) => h.text), ...(t.rows ?? []).map((r) => r.map((c) => c.text))]);
      else if (t.type === "code") d.code(t.text ?? "");
      else if (t.type === "blockquote") { for (const inner of t.tokens ?? []) d.quote(inlines(inner.tokens, inner.text).map((x) => x.text).join("")); }
      else if (t.type === "hr") d.pageBreak();
      else if (t.type === "html" && /<!--\s*pagebreak\s*-->/i.test(t.raw ?? "")) d.pageBreak();
    }
  };
  render(tokens);
  const file = await d.save(`${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "document"}.docx`);
  return { files: [file], stats: { Blocks: String(tokens.length) } };
};

export const fromSpreadsheet: FileProcessor = async (files, { options, onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = (await readSheets(files[i])).filter((s) => s.rows.length);
    if (!sheets.length) throw new ProcessorError(`${files[i].name} has no data`);
    const title = String(options.title ?? "").trim() || baseName(files[i].name);
    const d = new DocxWriter(title, String(options.font ?? "Calibri"));
    d.para(title, { style: "Title" });
    const mode = String(options.mode ?? "table");
    for (const s of sheets) {
      const rows = s.rows.map((r) => r.map((c) => cellText(c)));
      if (sheets.length > 1) d.heading(s.name, 1);
      if (mode === "table") d.table(rows.slice(0, Number(options.maxRows ?? 2000)));
      else {
        const header = rows[0];
        for (const r of rows.slice(1)) {
          d.heading(r[0] || "(untitled)", 2);
          d.bullets(header.slice(1).map((h, ci) => (r[ci + 1] ? [{ text: `${h}: `, bold: true }, { text: r[ci + 1] }] : null)).filter((x): x is Inline[] => Boolean(x)));
        }
      }
    }
    outputs.push(await d.save(`${baseName(files[i].name)}.docx`));
    onProgress?.((i + 1) / files.length);
  }
  return { files: await maybeZip(outputs, "documents.zip"), stats: { Documents: String(outputs.length) } };
};

export const mailMerge: FileProcessor = async (files, { options, onProgress, signal }) => {
  const template = files.find((f) => /\.docx$/i.test(f.name));
  const data = files.find((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!template || !data) throw new ProcessorError("Add one Word template (.docx) and one data file (.xlsx or .csv)", "Placeholders in the template look like {{First name}} or «First name» and must match the column headers.");
  const zip = await openPackage(template, "docx");
  const sheet = (await readSheets(data)).find((s) => s.rows.length > 1);
  if (!sheet) throw new ProcessorError("The data file has no rows");
  const headers = sheet.rows[0].map((c) => cellText(c).trim());
  const nameCol = String(options.nameColumn ?? "").trim();
  const nameIdx = nameCol ? headers.findIndex((h) => h.toLowerCase() === nameCol.toLowerCase()) : 0;
  const parts = await textParts(zip);
  const sources = new Map<string, string>();
  for (const p of parts) sources.set(p, (await readPart(zip, p)) ?? "");
  // Which placeholders exist?
  const allText = [...sources.values()].join(" ");
  const found = new Set<string>();
  for (const h of headers) if (h && (new RegExp(`\\{\\{\\s*${escapeRe(h)}\\s*\\}\\}`, "i").test(allText) || new RegExp(`«\\s*${escapeRe(h)}\\s*»`, "i").test(allText) || replaceInXml(allText, "w", `{{${h}}}`, "", { caseSensitive: false }).count)) found.add(h);
  if (!found.size) throw new ProcessorError("The template has no placeholders matching the column headers", `Columns: ${headers.filter(Boolean).join(", ")}. Write them as {{Column name}} in the template.`);
  const outputs: ProcessorFile[] = [];
  const rows = sheet.rows.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ""));
  for (let i = 0; i < rows.length; i++) {
    throwIfAborted(signal);
    const out = await clonePackage(zip);
    for (const p of parts) {
      let xml = sources.get(p)!;
      headers.forEach((h, ci) => {
        if (!h) return;
        const value = cellText(rows[i][ci]);
        for (const form of [`{{${h}}}`, `«${h}»`]) xml = replaceInXml(xml, "w", form, value, { caseSensitive: false }).xml;
        xml = replaceInXml(xml, "w", `\\{\\{\\s*${escapeRe(h)}\\s*\\}\\}`, value, { regex: true, caseSensitive: false }).xml;
      });
      writePart(out, p, xml);
    }
    const label = (nameIdx >= 0 ? cellText(rows[i][nameIdx]) : "") || `row-${i + 1}`;
    outputs.push(await savePackage(out, `${baseName(template.name)} - ${label.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}.docx`, MIME.docx));
    onProgress?.((i + 1) / rows.length, label);
  }
  return { files: [await zipFiles(outputs, `${baseName(template.name)}-merged.zip`, 0)], stats: { Documents: String(outputs.length), "Fields used": [...found].join(", ") }, warnings: headers.filter((h) => h && !found.has(h)).length ? [`Columns without a placeholder in the template: ${headers.filter((h) => h && !found.has(h)).join(", ")}`] : [] };
};

/* ---------- 13. Audit, 14. Compare ---------- */

export const audit: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  const lines: string[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "docx");
    const docXml = (await readPart(zip, "word/document.xml")) ?? "";
    const blocks = parseBody(docXml);
    const text = blocks.map((b) => b.text).join("\n");
    const words = wordCount(text);
    const chars = text.replace(/\s/g, "").length;
    const headings = blocks.filter((b) => b.kind === "p" && b.level >= 1 && b.level <= 6 && b.text.trim());
    const tables = blocks.filter((b) => b.kind === "table").length;
    const images = await imagesOfPart(zip, "word/document.xml");
    let mediaBytes = 0; const big: Row[] = [["Picture", "Size"]];
    for (const im of images) { const f = zip.file(im.path); if (!f) continue; const b = await f.async("uint8array"); mediaBytes += b.length; if (b.length > 1024 * 1024) big.push([im.path.slice("word/media/".length), formatBytes(b.length)]); }
    const ins = (docXml.match(/<w:ins\b/g) ?? []).length, del = (docXml.match(/<w:del\b/g) ?? []).length;
    const comments = (docXml.match(/<w:commentReference\b/g) ?? []).length;
    const hidden = (docXml.match(/<w:vanish\/>/g) ?? []).length;
    const footnotes = ((await readPart(zip, "word/footnotes.xml")) ?? "").match(/<w:footnote\b[^>]*w:id="[1-9]\d*"/g)?.length ?? 0;
    const links = (await readRels(zip, "word/document.xml")).filter((r) => r.external && r.type === REL.hyperlink).length;
    const fonts = fontsUsed(docXml + ((await readPart(zip, "word/styles.xml")) ?? ""));
    const core = (await readPart(zip, "docProps/core.xml")) ?? "";
    const meta = (tag: string) => core.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] ?? "";
    const sections = (docXml.match(/<w:sectPr\b/g) ?? []).length;
    const emptyParas = blocks.filter((b) => b.kind === "p" && !b.text.trim()).length;
    const longParas = blocks.filter((b) => b.kind === "p" && wordCount(b.text) > 150).length;
    const settings = (await readPart(zip, "word/settings.xml")) ?? "";
    const flags: string[] = [];
    if (ins + del) flags.push("has tracked changes");
    if (comments) flags.push("has comments");
    if (/<w:trackRevisions\b/.test(settings)) flags.push("track changes is ON");
    if (hidden) flags.push("hidden text");
    if (!headings.length && words > 600) flags.push("no heading styles (navigation pane empty)");
    if (emptyParas > 20) flags.push("many empty paragraphs used for spacing");
    if (big.length > 1) flags.push("large pictures");
    if (/<w:documentProtection\b/.test(settings)) flags.push("document protection set");
    const summary: Row[] = [["Document", files[i].name], ["Words", words], ["Characters (no spaces)", chars], ["Paragraphs", blocks.filter((b) => b.kind === "p").length], ["Empty paragraphs", emptyParas], ["Headings", headings.length], ["Tables", tables], ["Pictures", images.length], ["Picture data", formatBytes(mediaBytes)], ["Sections", sections], ["Hyperlinks", links], ["Footnotes", footnotes], ["Tracked insertions / deletions", `${ins} / ${del}`], ["Comments", comments], ["Hidden text runs", hidden], ["Very long paragraphs (>150 words)", longParas], ["Estimated pages (450 words/page)", Math.max(1, Math.ceil(words / 450))], ["Reading time (min, 230 wpm)", Math.round((words / 230) * 10) / 10], ["Author", meta("dc:creator")], ["Last modified by", meta("cp:lastModifiedBy")], ["Created", meta("dcterms:created")], ["Modified", meta("dcterms:modified")], ["Revision", meta("cp:revision")], ["Flags", flags.join("; ")]];
    const outline: Row[] = [["Level", "Heading", "Words until next heading"]];
    headings.forEach((h, hi) => { const start = blocks.indexOf(h); const end = hi + 1 < headings.length ? blocks.indexOf(headings[hi + 1]) : blocks.length; outline.push([h.level, h.text, wordCount(blocks.slice(start + 1, end).map((b) => b.text).join(" "))]); });
    const fontRows: Row[] = [["Font", "Uses"], ...[...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, n] as Row)];
    outputs.push(xlsxFile(`${baseName(files[i].name)}-audit.xlsx`, [{ name: "Summary", rows: summary }, { name: "Outline", rows: outline }, { name: "Fonts", rows: fontRows }, { name: "Large pictures", rows: big }]));
    lines.push(`${files[i].name}: ${words} words (~${Math.max(1, Math.ceil(words / 450))} pages), ${headings.length} headings, ${tables} tables, ${images.length} pictures, ${ins + del} tracked changes, ${comments} comments${flags.length ? ` · ${flags.join("; ")}` : ""}`);
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, text: lines.join("\n"), stats: { Documents: String(files.length) } };
};

export const compare: FileProcessor = async (files) => {
  if (files.length !== 2) throw new ProcessorError("Upload exactly two documents: the old and the new version");
  const texts = await Promise.all(files.map(async (f) => parseBody((await readPart(await openPackage(f, "docx"), "word/document.xml")) ?? "").map((b) => b.text).filter((t) => t.trim()).join("\n")));
  const ops = diffLines(texts[0], texts[1]);
  const sum = diffSummary(ops);
  const report = ops.filter((o) => o.type !== "same").map((o) => `${o.type === "add" ? "+" : "-"} ${o.text}`).join("\n") || "No text differences.";
  const d = new DocxWriter("Comparison");
  d.para(`Comparison: ${files[0].name} → ${files[1].name}`, { style: "Title" });
  d.para(`${sum.added} paragraph(s) added, ${sum.removed} removed, ${sum.unchanged} unchanged.`);
  for (const o of ops) if (o.type !== "same") d.para([{ text: o.type === "add" ? "+ " : "− ", bold: true }, { text: o.text, italic: o.type === "del" }]);
  return { files: [await d.save("comparison.docx"), fileFromText("comparison.txt", report)], text: report, stats: { Added: String(sum.added), Removed: String(sum.removed), Unchanged: String(sum.unchanged) } };
};

/* ---------- 17. Header / footer stamp ---------- */

export const headerFooter: FileProcessor = async (files, { options, onProgress, signal }) => {
  const headerText = String(options.header ?? "").trim();
  const footerText = String(options.footer ?? "").trim();
  const pageNumbers = Boolean(options.pageNumbers);
  if (!headerText && !footerText && !pageNumbers) throw new ProcessorError("Enter header text, footer text, or tick page numbers");
  const align = String(options.align ?? "right");
  const color = String(options.color ?? "#6B72B8").replace("#", "").toUpperCase();
  const outputs = await withDoc(files, onProgress, signal, async (file, zip, docXml) => {
    const out = await clonePackage(zip);
    let rels = (await readPart(out, relsPathFor("word/document.xml")))!;
    let ct = (await readPart(out, CT_PATH))!;
    const mk = (kind: "header" | "footer", text: string, withPage: boolean) => {
      const n = Object.keys(out.files).filter((p) => new RegExp(`^word/${kind}\\d+\\.xml$`).test(p)).length + 1;
      const path = `word/${kind}${n}.xml`;
      const run = (t: string) => `<w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEncode(t)}</w:t></w:r>`;
      const fld = (instr: string) => `<w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
      const content = [text ? run(text) : "", withPage ? (text ? run("   ") : "") + run("Page ") + fld("PAGE") + run(" of ") + fld("NUMPAGES") : ""].join("");
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:pPr><w:pStyle w:val="${kind === "header" ? "Header" : "Footer"}"/><w:jc w:val="${align === "center" ? "center" : align === "left" ? "left" : "right"}"/></w:pPr>${content}</w:p></w:${kind === "header" ? "hdr" : "ftr"}>`;
      writePart(out, path, xml);
      ct = ctAddOverride(ct, path, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`);
      const rid = nextRelId(rels);
      rels = addRel(rels, rid, kind === "header" ? REL.header : REL.footer, `${kind}${n}.xml`);
      return rid;
    };
    const hId = headerText ? mk("header", headerText, false) : null;
    const fId = footerText || pageNumbers ? mk("footer", footerText, pageNumbers) : null;
    const replace = options.replace !== false;
    let xml = docXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g, (sect) => {
      let s = sect.endsWith("/>") ? sect.replace(/\/>$/, "></w:sectPr>") : sect;
      if (replace) { if (hId) s = s.replace(/<w:headerReference\b[^>]*\/>/g, ""); if (fId) s = s.replace(/<w:footerReference\b[^>]*\/>/g, ""); s = s.replace(/<w:titlePg\/>/g, ""); }
      const refs = `${hId ? `<w:headerReference w:type="default" r:id="${hId}"/>` : ""}${fId ? `<w:footerReference w:type="default" r:id="${fId}"/>` : ""}`;
      return s.replace(/(<w:sectPr\b[^>]*>)/, `$1${refs}`);
    });
    if (!/<w:sectPr\b/.test(xml)) xml = xml.replace("</w:body>", `<w:sectPr>${hId ? `<w:headerReference w:type="default" r:id="${hId}"/>` : ""}${fId ? `<w:footerReference w:type="default" r:id="${fId}"/>` : ""}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>`);
    writePart(out, "word/document.xml", xml);
    writePart(out, relsPathFor("word/document.xml"), rels);
    writePart(out, CT_PATH, ct);
    return savePackage(out, `${baseName(file.name)}-stamped.docx`, MIME.docx);
  });
  return { files: await maybeZip(outputs, "stamped-documents.zip"), stats: { Documents: String(files.length) } };
};

export const _internal = { splitParagraphs };
