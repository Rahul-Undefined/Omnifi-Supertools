import type JSZip from "jszip";
import type { FileProcessor, TextProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import {
  openPackage, readPart, writePart, savePackage, clonePackage, readRels, relsPathFor, resolveTarget, parseRels, removeRel,
  REL, CT_PATH, ctRemoveOverride, paragraphText, splitParagraphs, replaceInXml, replaceFont, replaceColor, cleanMetadata,
  mediaParts, extOf, imagesOfPart, fontsUsed, wordCount, xmlDecode, MIME, escapeRe,
} from "../shared/ooxml";
import { PptxWriter } from "../shared/pptxwriter";
import { DocxWriter } from "../shared/docxwriter";
import { fileFromText, textOutput } from "../shared/output";
import { zipFiles, maybeZip } from "../shared/zip";
import { readSheets, xlsxFile, cellText, type Row } from "../shared/table";
import { parsePageRanges } from "../shared/pages";
import { diffLines, diffSummary } from "../shared/diff";
import { makeCanvas, ctx2d, canvasToBlob } from "../shared/canvas";
import { PdfWriter, NAVY, MUTED } from "../shared/pdfwriter";

export { mergeDecks } from "./merge";

/* ---------- Reading a deck ---------- */

export interface SlideRef { index: number; id: string; rId: string; path: string; hidden: boolean; xml: string }

export async function listSlides(zip: JSZip): Promise<SlideRef[]> {
  const pres = await readPart(zip, "ppt/presentation.xml");
  if (!pres) throw new ProcessorError("Not a PowerPoint file");
  const rels = await readRels(zip, "ppt/presentation.xml");
  const out: SlideRef[] = [];
  const ids = [...pres.matchAll(/<p:sldId\b([^>]*)\/>/g)].map((m) => ({ id: m[1].match(/\bid="(\d+)"/)?.[1] ?? "", rId: m[1].match(/\br:id="([^"]+)"/)?.[1] ?? "" }));
  for (const s of ids) {
    const rel = rels.find((r) => r.id === s.rId);
    if (!rel) continue;
    const path = resolveTarget("ppt/presentation.xml", rel.target);
    const xml = (await readPart(zip, path)) ?? "";
    out.push({ index: out.length, id: s.id, rId: s.rId, path, hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml), xml });
  }
  if (!out.length) throw new ProcessorError("The deck contains no slides");
  return out;
}

/** Paragraph texts of a slide in reading order, with the title first when present. */
export function slideParagraphs(xml: string): { title: string; paras: string[] } {
  let title = "";
  const paras: string[] = [];
  for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
    const s = sp[0];
    const isTitle = /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(s);
    const { chunks, isPara } = splitParagraphs(s, "a");
    const texts = chunks.filter((_, i) => isPara[i]).map((p) => paragraphText(p, "a").trim()).filter(Boolean);
    if (!texts.length) continue;
    if (isTitle && !title) title = texts.join(" ");
    else paras.push(...texts);
  }
  // Decks without placeholder titles (generated or hand-drawn): treat a short first line as the title.
  if (!title && paras.length && paras[0].length <= 80 && paras.length > 1) title = paras.shift()!;
  return { title, paras };
}

export async function notesText(zip: JSZip, slidePath: string): Promise<{ path: string | null; text: string }> {
  const rels = await readRels(zip, slidePath);
  const rel = rels.find((r) => r.type === REL.notesSlide);
  if (!rel) return { path: null, text: "" };
  const path = resolveTarget(slidePath, rel.target);
  const xml = (await readPart(zip, path)) ?? "";
  const bodies = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].filter((m) => /<p:ph\b[^>]*type="body"/.test(m[0]));
  const texts: string[] = [];
  for (const b of bodies) {
    const { chunks, isPara } = splitParagraphs(b[0], "a");
    texts.push(...chunks.filter((_, i) => isPara[i]).map((p) => paragraphText(p, "a").trim()).filter(Boolean));
  }
  return { path, text: texts.join("\n") };
}

async function withDeck(files: File[], onProgress: ((f: number, l?: string) => void) | undefined, signal: AbortSignal | undefined, fn: (file: File, zip: JSZip, slides: SlideRef[]) => Promise<ProcessorFile | ProcessorFile[]>) {
  const out: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    const r = await fn(files[i], zip, await listSlides(zip));
    out.push(...(Array.isArray(r) ? r : [r]));
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return out;
}

/* ---------- 1. Text extractor ---------- */

export const extractText: FileProcessor = async (files, { options, onProgress, signal }) => {
  const format = String(options.format ?? "txt");
  const withNotes = options.notes !== false;
  let slidesTotal = 0; let words = 0; let preview = "";
  const outputs = await withDeck(files, onProgress, signal, async (file, zip, slides) => {
    slidesTotal += slides.length;
    const lines: string[] = [];
    const doc = new DocxWriter(baseName(file.name));
    doc.para(baseName(file.name), { style: "Title" });
    for (const s of slides) {
      const { title, paras } = slideParagraphs(s.xml);
      const notes = withNotes ? (await notesText(zip, s.path)).text : "";
      const head = `Slide ${s.index + 1}${title ? `: ${title}` : ""}${s.hidden ? " (hidden)" : ""}`;
      if (format === "md") { lines.push(`## ${head}`, ""); lines.push(...paras.map((p) => `- ${p}`)); if (notes) lines.push("", "> **Notes:** " + notes.replace(/\n/g, "\n> ")); lines.push(""); }
      else { lines.push(head, "-".repeat(head.length), ...paras, ...(notes ? ["", "Notes: " + notes] : []), ""); }
      doc.heading(head, 2);
      if (paras.length) doc.bullets(paras);
      if (notes) doc.para([{ text: "Notes: ", bold: true }, { text: notes }]);
      words += wordCount([...paras, notes].join(" "));
    }
    const text = lines.join("\n").trim();
    if (!preview) preview = text;
    if (format === "docx") return doc.save(`${baseName(file.name)}-text.docx`);
    return fileFromText(`${baseName(file.name)}-text.${format === "md" ? "md" : "txt"}`, text, format === "md" ? "text/markdown" : "text/plain");
  });
  return { files: await maybeZip(outputs, "slide-text.zip"), text: files.length === 1 && format !== "docx" ? preview : undefined, stats: { Slides: String(slidesTotal), Words: words.toLocaleString() } };
};

/* ---------- 2. Image extractor ---------- */

export const extractImages: FileProcessor = async (files, { options, onProgress, signal }) => {
  const onlyUsed = Boolean(options.onlyUsed);
  const outputs: ProcessorFile[] = [];
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    let media = mediaParts(zip, "ppt/media").filter((p) => /^(png|jpe?g|gif|bmp|tiff?|webp|svg|emf|wmf)$/.test(extOf(p)));
    if (onlyUsed) {
      const used = new Set<string>();
      for (const s of await listSlides(zip)) for (const im of await imagesOfPart(zip, s.path)) used.add(im.path);
      media = media.filter((p) => used.has(p));
    }
    const seen = new Set<string>();
    for (const p of media) {
      const bytes = await zip.file(p)!.async("uint8array");
      const key = `${bytes.length}:${bytes.slice(0, 64).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = files.length > 1 ? `${baseName(files[i].name)}/${p.slice("ppt/media/".length)}` : p.slice("ppt/media/".length);
      outputs.push({ name, blob: new Blob([bytes as BlobPart]), bytes: bytes.length });
      count++;
    }
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  if (!outputs.length) throw new ProcessorError("No images found in the deck", onlyUsed ? "Try without 'only images used on slides'." : "The deck has no embedded pictures (charts and shapes are not pictures).");
  return { files: [await zipFiles(outputs, files.length === 1 ? `${baseName(files[0].name)}-images.zip` : "deck-images.zip", 0)], stats: { Images: String(count), Size: formatBytes(outputs.reduce((a, f) => a + f.bytes, 0)) } };
};

/* ---------- 3. Slides to images, 4. Handout, 5. Notes document ---------- */

async function renderDeckPdf(file: File, signal?: AbortSignal): Promise<{ bytes: Uint8Array; slides: number }> {
  const { pptxToPdf } = await import("../office/topdf");
  const r = await pptxToPdf([file], { options: { slideNumbers: false }, signal });
  return { bytes: new Uint8Array(await r.files[0].blob.arrayBuffer()), slides: Number(r.stats?.Slides ?? 0) };
}

export const toImages: FileProcessor = async (files, { options, onProgress, signal }) => {
  const { toImages: pdfToImages } = await import("../pdf");
  const outputs: ProcessorFile[] = [];
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const pdf = await renderDeckPdf(files[i], signal);
    const r = await pdfToImages([new File([pdf.bytes as BlobPart], `${baseName(files[i].name)}.pdf`, { type: "application/pdf" })], { options: { format: String(options.format ?? "png"), scale: Number(options.scale ?? 2) }, signal, onProgress: (f, l) => onProgress?.((i + f) / files.length, l) });
    const named = r.files.map((f) => ({ ...f, name: f.name.replace(/page/i, "slide") }));
    outputs.push(...named);
    count += named.length;
  }
  return { files: await maybeZip(outputs, "slides.zip"), stats: { Slides: String(count) }, warnings: ["Slides are rebuilt by SuperTools from text and pictures at their original positions (not rendered by PowerPoint): theme backgrounds, shapes and charts are not drawn."] };
};

export const handout: FileProcessor = async (files, { options, onProgress, signal }) => {
  const { PDFDocument } = await import("pdf-lib");
  const per = Number(options.perPage ?? 4);
  const withNotes = Boolean(options.notes);
  const outputs: ProcessorFile[] = [];
  let slidesTotal = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    const slides = await listSlides(zip);
    const pdf = await renderDeckPdf(files[i], signal);
    const src = await PDFDocument.load(pdf.bytes);
    const pw = await PdfWriter.create({ landscape: per === 2 && !withNotes ? false : per === 6 ? false : false, margin: 36 });
    pw.doc.removePage(0); pw.pageCount = 0;
    const embedded = await pw.doc.embedPdf(src, src.getPageIndices());
    const cols = per === 2 ? 1 : 2; const rows = per === 2 ? 2 : per === 4 ? 2 : 3;
    const pageW = pw.width - 72, pageH = pw.height - 72 - 20;
    const cellW = pageW / cols, cellH = pageH / rows;
    const slideW = withNotes ? cellW * 0.55 : cellW - 12;
    const aspect = src.getPage(0).getHeight() / src.getPage(0).getWidth();
    const slideH = Math.min(cellH - 24, slideW * aspect);
    const drawW = slideH / aspect;
    for (let k = 0; k < embedded.length; k++) {
      if (k % per === 0) { pw.addPage(); pw.page.drawText(`${baseName(files[i].name)}  ·  slides ${k + 1}-${Math.min(embedded.length, k + per)} of ${embedded.length}`, { x: 36, y: pw.height - 28, size: 9, font: pw.font(), color: MUTED }); }
      const cell = k % per; const c = cell % cols; const r = Math.floor(cell / cols);
      const x = 36 + c * cellW + 6; const yTop = pw.height - 36 - 20 - r * cellH - 6;
      pw.page.drawPage(embedded[k], { x, y: yTop - slideH, width: drawW, height: slideH });
      pw.page.drawRectangle({ x, y: yTop - slideH, width: drawW, height: slideH, borderColor: MUTED, borderWidth: 0.5 });
      pw.page.drawText(String(k + 1), { x, y: yTop - slideH - 11, size: 8, font: pw.font(), color: MUTED });
      if (withNotes) {
        const notes = (await notesText(zip, slides[k].path)).text || "—";
        pw.textBox(notes, x + drawW + 10, yTop, cellW - drawW - 22, slideH, { size: 9, color: NAVY });
      }
      onProgress?.((i + (k + 1) / embedded.length) / files.length, `Slide ${k + 1}`);
    }
    slidesTotal += embedded.length;
    const bytes = await pw.save();
    outputs.push({ name: `${baseName(files[i].name)}-handout.pdf`, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), bytes: bytes.length, mime: "application/pdf" });
  }
  return { files: outputs, stats: { Slides: String(slidesTotal), "Per page": String(per) }, warnings: ["Slide thumbnails are rebuilt from text and pictures; theme backgrounds, shapes and charts are not drawn."] };
};

export const notesDocument: FileProcessor = async (files, { options, onProgress, signal }) => {
  const includeSlideText = options.slideText !== false;
  let notesCount = 0;
  const outputs = await withDeck(files, onProgress, signal, async (file, zip, slides) => {
    const doc = new DocxWriter(`${baseName(file.name)} notes`);
    doc.para(`${baseName(file.name)}: speaker notes`, { style: "Title" });
    const lines: string[] = [];
    for (const s of slides) {
      const { title, paras } = slideParagraphs(s.xml);
      const notes = (await notesText(zip, s.path)).text;
      if (notes) notesCount++;
      doc.heading(`Slide ${s.index + 1}${title ? `: ${title}` : ""}`, 2);
      if (includeSlideText && paras.length) { doc.para([{ text: "On the slide", bold: true }]); doc.bullets(paras.slice(0, 12)); }
      doc.para([{ text: "Notes", bold: true }]);
      doc.para(notes || "(no notes)");
      lines.push(`Slide ${s.index + 1}${title ? `: ${title}` : ""}`, notes || "(no notes)", "");
    }
    return [await doc.save(`${baseName(file.name)}-notes.docx`), fileFromText(`${baseName(file.name)}-notes.txt`, lines.join("\n"))];
  });
  return { files: await maybeZip(outputs, "speaker-notes.zip"), stats: { "Slides with notes": String(notesCount) } };
};

/* ---------- 7. Split / extract ---------- */

export async function keepSlides(zip: JSZip, slides: SlideRef[], keep: Set<number>): Promise<JSZip> {
  const out = await clonePackage(zip);
  let pres = (await readPart(out, "ppt/presentation.xml"))!;
  let presRels = (await readPart(out, relsPathFor("ppt/presentation.xml")))!;
  let ct = (await readPart(out, CT_PATH))!;
  for (const s of slides) {
    if (keep.has(s.index)) continue;
    pres = pres.replace(new RegExp(`<p:sldId\\b[^>]*\\br:id="${escapeRe(s.rId)}"[^>]*/>`), "");
    presRels = removeRel(presRels, s.rId);
    // Notes slide owned by this slide.
    const rels = await readRels(out, s.path);
    const notes = rels.find((r) => r.type === REL.notesSlide);
    if (notes) {
      const np = resolveTarget(s.path, notes.target);
      out.remove(np); out.remove(relsPathFor(np)); ct = ctRemoveOverride(ct, np);
    }
    out.remove(s.path); out.remove(relsPathFor(s.path)); ct = ctRemoveOverride(ct, s.path);
  }
  writePart(out, "ppt/presentation.xml", pres);
  writePart(out, relsPathFor("ppt/presentation.xml"), presRels);
  writePart(out, CT_PATH, ct);
  const app = await readPart(out, "docProps/app.xml");
  if (app) writePart(out, "docProps/app.xml", app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${keep.size}</Slides>`).replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, "").replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, ""));
  return out;
}

export const splitDeck: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "extract");
  const every = Math.max(1, Number(options.every ?? 1));
  let produced = 0;
  const outputs = await withDeck(files, onProgress, signal, async (file, zip, slides) => {
    const groups: number[][] = [];
    if (mode === "extract") groups.push(parsePageRanges(String(options.ranges ?? ""), slides.length));
    else if (mode === "each") slides.forEach((s) => groups.push([s.index]));
    else for (let i = 0; i < slides.length; i += every) groups.push(slides.slice(i, i + every).map((s) => s.index));
    const outs: ProcessorFile[] = [];
    for (let g = 0; g < groups.length; g++) {
      throwIfAborted(signal);
      const kept = await keepSlides(zip, slides, new Set(groups[g]));
      const label = groups.length === 1 ? "selected" : groups[g].length === 1 ? `slide-${groups[g][0] + 1}` : `slides-${groups[g][0] + 1}-${groups[g][groups[g].length - 1] + 1}`;
      outs.push(await savePackage(kept, `${baseName(file.name)}-${label}.pptx`, MIME.pptx));
      produced++;
    }
    return outs;
  });
  return { files: await maybeZip(outputs, "split-decks.zip"), stats: { Decks: String(produced) } };
};

/* ---------- 8. Find & replace ---------- */

async function textParts(zip: JSZip, opts: { notes?: boolean; masters?: boolean }): Promise<string[]> {
  const slides = (await listSlides(zip)).map((s) => s.path);
  const parts = [...slides];
  if (opts.notes) parts.push(...Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)));
  if (opts.masters) parts.push(...Object.keys(zip.files).filter((n) => /^ppt\/(slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n)));
  parts.push(...Object.keys(zip.files).filter((n) => /^ppt\/(charts\/chart\d+|diagrams\/data\d+)\.xml$/.test(n)));
  return [...new Set(parts)];
}

function parsePairs(input: string): [string, string][] {
  return input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*(?:=>|->|→|\t)\s*(.*)$/);
    return m ? [m[1], m[2]] : [l, ""];
  });
}

export const findReplace: FileProcessor = async (files, { options, onProgress, signal }) => {
  const pairs = String(options.pairs ?? "").trim() ? parsePairs(String(options.pairs)) : [[String(options.find ?? ""), String(options.replace ?? "")] as [string, string]];
  if (!pairs.some(([f]) => f)) throw new ProcessorError("Enter the text to find", "Example: Acme Corp => Omnifi");
  const ro = { regex: Boolean(options.regex), caseSensitive: Boolean(options.caseSensitive), wholeWord: Boolean(options.wholeWord) };
  let total = 0;
  const outputs = await withDeck(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    let count = 0;
    for (const p of await textParts(out, { notes: options.notes !== false, masters: Boolean(options.masters) })) {
      let xml = (await readPart(out, p)) ?? "";
      for (const [f, r] of pairs) { if (!f) continue; const res = replaceInXml(xml, "a", f, r, ro); xml = res.xml; count += res.count; }
      writePart(out, p, xml);
    }
    total += count;
    return savePackage(out, `${baseName(file.name)}-replaced.pptx`, MIME.pptx);
  });
  return { files: await maybeZip(outputs, "replaced-decks.zip"), stats: { Replacements: String(total) }, warnings: total === 0 ? ["Nothing matched. Check spelling, case, and whether the text is inside a picture (pictures cannot be edited)."] : [] };
};

/* ---------- 9. Font & colour replace ---------- */

export const fontColor: FileProcessor = async (files, { options, onProgress, signal }) => {
  const fontFrom = String(options.fontFrom ?? "").trim(), fontTo = String(options.fontTo ?? "").trim();
  const colorFrom = String(options.colorFrom ?? "").trim(), colorTo = String(options.colorTo ?? "").trim();
  if (!(fontFrom && fontTo) && !(colorFrom && colorTo)) throw new ProcessorError("Enter a font pair and/or a colour pair");
  let fonts = 0, colors = 0;
  const outputs = await withDeck(files, onProgress, signal, async (file, zip) => {
    const out = await clonePackage(zip);
    const parts = Object.keys(out.files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|notesMasters|theme|charts|diagrams)\/[^/]+\.xml$/.test(n));
    for (const p of parts) {
      let xml = (await readPart(out, p)) ?? "";
      if (fontFrom && fontTo) { const r = replaceFont(xml, fontFrom, fontTo); xml = r.xml; fonts += r.count; }
      if (colorFrom && colorTo) { const r = replaceColor(xml, colorFrom, colorTo); xml = r.xml; colors += r.count; }
      writePart(out, p, xml);
    }
    return savePackage(out, `${baseName(file.name)}-restyled.pptx`, MIME.pptx);
  });
  return { files: await maybeZip(outputs, "restyled-decks.zip"), stats: { "Font changes": String(fonts), "Colour changes": String(colors) }, warnings: fonts + colors === 0 ? ["Nothing matched. Font names must match exactly (e.g. 'Calibri'), colours are hex like #1F3A93. Theme fonts (+mj-lt) live in the theme; tick 'Change the theme too'."] : [] };
};

/* ---------- 10. Clean copy ---------- */

export const cleanCopy: FileProcessor = async (files, { options, onProgress, signal }) => {
  const report: string[] = [];
  const outputs = await withDeck(files, onProgress, signal, async (file, zip, slides) => {
    let out = await clonePackage(zip);
    const done: string[] = [];
    if (options.hidden !== false) {
      const hidden = slides.filter((s) => s.hidden);
      if (hidden.length) { out = await keepSlides(out, slides, new Set(slides.filter((s) => !s.hidden).map((s) => s.index))); done.push(`${hidden.length} hidden slide(s) removed`); }
    }
    let ct = (await readPart(out, CT_PATH))!;
    if (options.notes !== false) {
      let n = 0;
      for (const s of await listSlides(out)) {
        const relsPath = relsPathFor(s.path);
        const relsXml = (await readPart(out, relsPath)) ?? "";
        for (const r of parseRels(relsXml).filter((r) => r.type === REL.notesSlide)) {
          const np = resolveTarget(s.path, r.target);
          out.remove(np); out.remove(relsPathFor(np)); ct = ctRemoveOverride(ct, np);
          writePart(out, relsPath, removeRel((await readPart(out, relsPath))!, r.id));
          n++;
        }
      }
      if (n) done.push(`${n} speaker-notes page(s) removed`);
    }
    if (options.comments !== false) {
      let n = 0;
      for (const p of Object.keys(out.files).filter((x) => /^ppt\/comments\/|^ppt\/commentAuthors\.xml$|^ppt\/authors\.xml$/.test(x))) { out.remove(p); ct = ctRemoveOverride(ct, p); n++; }
      for (const relsPath of Object.keys(out.files).filter((x) => x.endsWith(".rels"))) {
        const xml = (await readPart(out, relsPath)) ?? "";
        const cleaned = xml.replace(/<Relationship\b[^>]*Type="[^"]*\/(?:comments|commentAuthors|authors)"[^>]*\/>/g, "");
        if (cleaned !== xml) writePart(out, relsPath, cleaned);
      }
      if (n) done.push(`${n} comment part(s) removed`);
    }
    writePart(out, CT_PATH, ct);
    if (options.metadata !== false) {
      const removed = await cleanMetadata(out, { keepTitle: true });
      if (removed.length) done.push(`metadata cleared (${removed.join(", ")})`);
    }
    report.push(`${file.name}: ${done.length ? done.join("; ") : "nothing to clean"}`);
    return savePackage(out, `${baseName(file.name)}-clean.pptx`, MIME.pptx);
  });
  return { files: await maybeZip(outputs, "clean-decks.zip"), text: report.join("\n"), stats: { Decks: String(files.length) } };
};

/* ---------- 11. Compressor ---------- */

export async function recompressMedia(zip: JSZip, folder: "ppt/media" | "word/media", maxPx: number, quality: number, onProgress?: (f: number) => void): Promise<{ before: number; after: number; changed: number }> {
  const parts = mediaParts(zip, folder).filter((p) => /^(png|jpe?g|bmp)$/.test(extOf(p)));
  let before = 0, after = 0, changed = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const bytes = await zip.file(p)!.async("uint8array");
    before += bytes.length;
    let kept = bytes.length;
    try {
      const ext = extOf(p);
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
      const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const isJpeg = ext === "jpg" || ext === "jpeg";
      if (scale < 1 || (isJpeg && bytes.length > 150_000) || (ext === "bmp")) {
        const c = makeCanvas(w, h);
        ctx2d(c).drawImage(bmp, 0, 0, w, h);
        const blob = await canvasToBlob(c, isJpeg ? "image/jpeg" : "image/png", isJpeg ? quality : undefined);
        if (blob.size < bytes.length * 0.95) { zip.file(p, new Uint8Array(await blob.arrayBuffer())); kept = blob.size; changed++; }
      }
      bmp.close();
    } catch { /* unsupported image: leave as is */ }
    after += kept;
    onProgress?.((i + 1) / parts.length);
  }
  return { before, after, changed };
}

export const compress: FileProcessor = async (files, { options, onProgress, signal }) => {
  const maxPx = Number(options.maxPx ?? 1920);
  const quality = Number(options.quality ?? 0.8);
  const outputs: ProcessorFile[] = [];
  let totalBefore = 0, totalAfter = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    const r = await recompressMedia(zip, "ppt/media", maxPx, quality, (f) => onProgress?.((i + f) / files.length, files[i].name));
    if (options.removeUnused) {
      const used = new Set<string>();
      for (const relsPath of Object.keys(zip.files).filter((x) => x.endsWith(".rels"))) {
        const part = relsPath.replace(/_rels\/([^/]+)\.rels$/, "$1");
        for (const rel of parseRels((await readPart(zip, relsPath)) ?? "")) if (!rel.external) used.add(resolveTarget(part, rel.target));
      }
      for (const p of mediaParts(zip, "ppt/media")) if (!used.has(p)) zip.remove(p);
    }
    const saved = await savePackage(zip, `${baseName(files[i].name)}-compressed.pptx`, MIME.pptx);
    totalBefore += files[i].size; totalAfter += saved.bytes;
    outputs.push(saved);
    void r;
  }
  const pct = totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
  return { files: await maybeZip(outputs, "compressed-decks.zip"), stats: { Before: formatBytes(totalBefore), After: formatBytes(totalAfter), Saved: `${Math.max(0, pct)}%` }, warnings: pct < 5 ? ["Little to gain: the deck has few large pictures, or they are already compressed. Embedded videos, EMF/WMF and SVG graphics are left untouched."] : [] };
};

/* ---------- 12. Link checker ---------- */

export async function collectLinks(zip: JSZip, parts: string[]): Promise<{ part: string; url: string }[]> {
  const out: { part: string; url: string }[] = [];
  for (const p of parts) for (const r of await readRels(zip, p)) if (r.external && r.type === REL.hyperlink) out.push({ part: p, url: r.target });
  return out;
}

export async function checkLinks(links: string[], onProgress?: (f: number) => void): Promise<Map<string, { status: number | string; ok: boolean; finalUrl?: string }>> {
  const results = new Map<string, { status: number | string; ok: boolean; finalUrl?: string }>();
  const queue = [...new Set(links)];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift()!;
      if (!/^https?:\/\//i.test(url)) { results.set(url, { status: url.startsWith("mailto:") ? "mailto (not checked)" : "not http", ok: true }); }
      else {
        try {
          const res = await fetch("/api/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "headers", target: url, options: {} }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) results.set(url, { status: data.error ?? `error ${res.status}`, ok: false });
          else results.set(url, { status: data.data?.status ?? "?", ok: Number(data.data?.status) < 400, finalUrl: data.data?.url });
        } catch (e) { results.set(url, { status: e instanceof Error ? e.message : "failed", ok: false }); }
      }
      onProgress?.(++done / links.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return results;
}

export const linkCheck: FileProcessor = async (files, { onProgress, signal }) => {
  const rows: Row[] = [["Deck", "Slide", "Link", "Status", "Final URL"]];
  let broken = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    const slides = await listSlides(zip);
    const links = await collectLinks(zip, slides.map((s) => s.path));
    const results = await checkLinks(links.map((l) => l.url), (f) => onProgress?.((i + f) / files.length));
    for (const l of links) {
      const r = results.get(l.url)!;
      const slide = slides.find((s) => s.path === l.part)?.index ?? -1;
      if (!r.ok) broken++;
      rows.push([files[i].name, slide + 1, l.url, String(r.status), r.finalUrl && r.finalUrl !== l.url ? r.finalUrl : ""]);
    }
  }
  if (rows.length === 1) throw new ProcessorError("No hyperlinks found in the deck(s)");
  const text = rows.slice(1).map((r) => `${r[3]}  slide ${r[1]}  ${r[2]}`).join("\n");
  return { files: [xlsxFile("link-check.xlsx", [{ name: "Links", rows }])], text, data: { header: rows[0] as string[], rows: rows.slice(1) as (string | number)[][] }, stats: { Links: String(rows.length - 1), Broken: String(broken) } };
};

/* ---------- 13. Spreadsheet to slides, 14. Markdown, 15. Agenda, 16. Chart ---------- */

export const fromSpreadsheet: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "rows");
  const per = Math.max(3, Math.min(25, Number(options.rowsPerSlide ?? 12)));
  const outputs: ProcessorFile[] = [];
  let slidesTotal = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = (await readSheets(files[i])).filter((s) => s.rows.length > 1);
    if (!sheets.length) throw new ProcessorError(`${files[i].name} has no rows`);
    const deckTitle = String(options.title ?? "").trim() || baseName(files[i].name);
    const w = new PptxWriter(deckTitle);
    w.titleSlide(deckTitle, `${sheets.reduce((a, s) => a + s.rows.length - 1, 0)} rows · generated ${new Date().toLocaleDateString()}`);
    for (const s of sheets) {
      const rows = s.rows.map((r) => r.map((c) => cellText(c)));
      const header = rows[0];
      if (sheets.length > 1) w.sectionSlide(s.name, `${rows.length - 1} rows`);
      if (mode === "rows") {
        for (const r of rows.slice(1)) {
          const title = r[0] || "(untitled)";
          const bullets = header.slice(1).map((h, ci) => (r[ci + 1] ? `${h}: ${r[ci + 1]}` : "")).filter(Boolean);
          w.bulletSlide(title, bullets);
        }
      } else {
        for (let k = 1; k < rows.length; k += per) w.tableSlide(rows.length - 1 > per ? `${s.name} (${k}-${Math.min(rows.length - 1, k + per - 1)} of ${rows.length - 1})` : s.name, [header, ...rows.slice(k, k + per)]);
      }
    }
    slidesTotal += w.slideCount;
    outputs.push(await w.save(`${baseName(files[i].name)}.pptx`));
    onProgress?.((i + 1) / files.length);
  }
  return { files: await maybeZip(outputs, "generated-decks.zip"), stats: { Slides: String(slidesTotal) } };
};

type MdToken = { type: string; depth?: number; text?: string; tokens?: MdToken[]; items?: { text: string; tokens?: MdToken[]; task?: boolean }[]; header?: { text: string }[]; rows?: { text: string }[][]; raw?: string; ordered?: boolean };

export const fromMarkdown: TextProcessor = async (input, { options }) => {
  const { marked } = await import("marked");
  const tokens = marked.lexer(input) as unknown as MdToken[];
  if (!tokens.length) throw new ProcessorError("Paste some Markdown first", "# Deck title, ## Slide title, - bullet points, tables and paragraphs become slides.");
  const deckTitle = String(options.title ?? "").trim() || (tokens.find((t) => t.type === "heading" && t.depth === 1)?.text ?? "Presentation");
  const w = new PptxWriter(deckTitle);
  let current: { title: string; bullets: { text: string; level: number }[]; paras: string[]; table?: string[][] } | null = null;
  const flush = () => {
    if (!current) return;
    if (current.table) w.tableSlide(current.title, current.table);
    else if (current.bullets.length) w.bulletSlide(current.title, current.bullets);
    else if (current.paras.length) w.textSlide(current.title, current.paras);
    else w.sectionSlide(current.title);
    current = null;
  };
  const plain = (t: string) => t.replace(/\*\*|__|`|~~/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
  let first = true;
  for (const t of tokens) {
    if (t.type === "heading") {
      if (t.depth === 1 && first) { w.titleSlide(plain(t.text ?? ""), String(options.subtitle ?? "")); first = false; continue; }
      flush();
      if (t.depth === 1) { w.sectionSlide(plain(t.text ?? "")); continue; }
      current = { title: plain(t.text ?? ""), bullets: [], paras: [] };
      first = false;
    } else if (t.type === "list") {
      if (!current) current = { title: deckTitle, bullets: [], paras: [] };
      const walk = (items: NonNullable<MdToken["items"]>, level: number) => {
        for (const it of items) {
          const firstLine = (it.tokens?.find((x) => x.type === "text" || x.type === "paragraph")?.text ?? it.text ?? "").split("\n")[0];
          current!.bullets.push({ text: plain(firstLine), level });
          const sub = it.tokens?.find((x) => x.type === "list");
          if (sub?.items) walk(sub.items, level + 1);
        }
      };
      walk(t.items ?? [], 0);
    } else if (t.type === "paragraph" || t.type === "blockquote" || t.type === "code") {
      if (!current) current = { title: deckTitle, bullets: [], paras: [] };
      current.paras.push(plain(t.type === "code" ? (t.text ?? "") : (t.text ?? t.raw ?? "")));
    } else if (t.type === "table") {
      if (!current) current = { title: deckTitle, bullets: [], paras: [] };
      current.table = [(t.header ?? []).map((h) => plain(h.text)), ...(t.rows ?? []).map((r) => r.map((c) => plain(c.text)))];
    } else if (t.type === "hr") { flush(); }
  }
  flush();
  if (!w.slideCount) throw new ProcessorError("No slide content recognised");
  const file = await w.save(`${deckTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "deck"}.pptx`);
  return { files: [file], stats: { Slides: String(w.slideCount) } };
};

export const agenda: TextProcessor = async (input, { options }) => {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new ProcessorError("Enter one section per line", "Example: Q2 results | Revenue, margin, cash");
  const title = String(options.title ?? "").trim() || "Agenda";
  const w = new PptxWriter(title);
  w.titleSlide(title, String(options.subtitle ?? ""));
  const sections = lines.map((l, i) => { const [name, sub] = l.split("|").map((s) => s.trim()); return { n: i + 1, name: name.replace(/^\d+[.)]\s*/, ""), sub: sub ?? "" }; });
  w.bulletSlide("Agenda", sections.map((s) => `${s.n}. ${s.name}${s.sub ? ` — ${s.sub}` : ""}`));
  for (const s of sections) {
    w.sectionSlide(`${String(s.n).padStart(2, "0")}  ${s.name}`, s.sub);
    if (options.placeholders !== false) w.bulletSlide(s.name, ["Key point", "Supporting detail", "Next step"]);
  }
  const file = await w.save(`${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}.pptx`);
  return { files: [file], stats: { Sections: String(sections.length), Slides: String(w.slideCount) } };
};

function drawChart(type: string, labels: string[], series: { name: string; values: number[] }[], w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  const c = makeCanvas(w, h); const g = ctx2d(c) as CanvasRenderingContext2D;
  const colors = ["#4F5BD5", "#0A0F3D", "#6B72B8", "#2BB673", "#F2A33A", "#E05252"];
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, w, h);
  g.font = "22px Calibri, Arial, sans-serif"; g.fillStyle = "#1F2340"; g.textBaseline = "middle";
  if (type === "pie") {
    const vals = series[0].values; const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = w * 0.38, cy = h / 2, r = Math.min(w, h) * 0.38;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => { const ang = (Math.max(0, v) / total) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a, a + ang); g.closePath(); g.fillStyle = colors[i % colors.length]; g.fill(); a += ang; });
    labels.forEach((l, i) => { const y = 60 + i * 34; g.fillStyle = colors[i % colors.length]; g.fillRect(w * 0.72, y - 10, 20, 20); g.fillStyle = "#1F2340"; g.textAlign = "left"; g.fillText(`${l}  ${Math.round((Math.max(0, vals[i]) / total) * 100)}%`, w * 0.72 + 30, y); });
    return c;
  }
  const left = 90, right = w - 30, top = 40, bottom = h - 70;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const range = max - min || 1;
  const y = (v: number) => bottom - ((v - min) / range) * (bottom - top);
  g.strokeStyle = "#E3E5F0"; g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const v = min + (range * i) / 5; const yy = y(v); g.beginPath(); g.moveTo(left, yy); g.lineTo(right, yy); g.stroke(); g.fillStyle = "#6B72B8"; g.textAlign = "right"; g.font = "16px Calibri, Arial, sans-serif"; g.fillText(Number.isInteger(v) ? String(v) : v.toFixed(1), left - 8, yy); }
  const n = labels.length; const slot = (right - left) / Math.max(1, n);
  g.font = "16px Calibri, Arial, sans-serif";
  labels.forEach((l, i) => { g.fillStyle = "#1F2340"; g.textAlign = "center"; g.fillText(l.length > 14 ? l.slice(0, 13) + "…" : l, left + slot * (i + 0.5), bottom + 18); });
  if (type === "line") {
    series.forEach((s, si) => { g.strokeStyle = colors[si % colors.length]; g.lineWidth = 3; g.beginPath(); s.values.forEach((v, i) => { const px = left + slot * (i + 0.5), py = y(v); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }); g.stroke(); s.values.forEach((v, i) => { g.fillStyle = colors[si % colors.length]; g.beginPath(); g.arc(left + slot * (i + 0.5), y(v), 5, 0, Math.PI * 2); g.fill(); }); });
  } else {
    const bw = (slot * 0.7) / series.length;
    series.forEach((s, si) => s.values.forEach((v, i) => { const px = left + slot * i + slot * 0.15 + bw * si; g.fillStyle = colors[si % colors.length]; const y0 = y(0), y1 = y(v); g.fillRect(px, Math.min(y0, y1), bw - 2, Math.abs(y0 - y1)); }));
  }
  if (series.length > 1) series.forEach((s, si) => { const lx = left + si * 160; g.fillStyle = colors[si % colors.length]; g.fillRect(lx, 12, 16, 16); g.fillStyle = "#1F2340"; g.textAlign = "left"; g.fillText(s.name, lx + 22, 20); });
  return c;
}

export const chartSlide: FileProcessor = async (files, { options, onProgress, signal }) => {
  const type = String(options.type ?? "bar");
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = (await readSheets(files[i])).filter((s) => s.rows.length > 1);
    if (!sheets.length) throw new ProcessorError(`${files[i].name} has no data`);
    const w = new PptxWriter(String(options.title ?? "").trim() || baseName(files[i].name));
    for (const s of sheets) {
      const rows = s.rows.filter((r) => r.some((c) => c != null && c !== ""));
      const header = rows[0].map((c) => cellText(c));
      const labels = rows.slice(1).map((r) => cellText(r[0]));
      const numericCols = header.slice(1).map((_, ci) => ci + 1).filter((ci) => rows.slice(1).some((r) => typeof r[ci] === "number" || /^-?[\d,.]+$/.test(cellText(r[ci]).trim())));
      if (!numericCols.length) throw new ProcessorError(`No numeric columns found in ${s.name}`, "First column = labels, next columns = numbers.");
      const series = numericCols.slice(0, type === "pie" ? 1 : 6).map((ci) => ({ name: header[ci] || `Series ${ci}`, values: rows.slice(1).map((r) => Number(String(r[ci] ?? "0").replace(/[,$%\s]/g, "")) || 0) }));
      const canvas = drawChart(type, labels, series, 1600, 900);
      const blob = await canvasToBlob(canvas, "image/png");
      w.imageSlide(String(options.title ?? "").trim() || s.name, new Uint8Array(await blob.arrayBuffer()), "png", 1600, 900, `${type} chart · ${labels.length} categories · source: ${files[i].name}`);
      if (options.includeTable) w.tableSlide(`${s.name}: data`, rows.slice(0, 16).map((r) => r.map((c) => cellText(c))));
    }
    outputs.push(await w.save(`${baseName(files[i].name)}-chart.pptx`));
    onProgress?.((i + 1) / files.length);
  }
  return { files: await maybeZip(outputs, "chart-decks.zip"), stats: { Decks: String(outputs.length) }, warnings: ["The chart is inserted as a picture (not a native editable PowerPoint chart)."] };
};

/* ---------- 17. Audit, 18. Compare ---------- */

export const audit: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  const summaryLines: string[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openPackage(files[i], "pptx");
    const slides = await listSlides(zip);
    const pres = (await readPart(zip, "ppt/presentation.xml")) ?? "";
    const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    const sizeIn = sz ? `${(Number(sz[1]) / 914400).toFixed(2)} x ${(Number(sz[2]) / 914400).toFixed(2)} in` : "?";
    const fonts = new Map<string, number>();
    const perSlide: Row[] = [["Slide", "Title", "Hidden", "Words", "Text boxes", "Pictures", "Largest picture", "Notes", "Links", "Empty placeholders", "Flags"]];
    const bigImages: Row[] = [["Slide", "Picture", "Size"]];
    let totalWords = 0, hidden = 0, withNotes = 0, emptyPh = 0, links = 0;
    for (const s of slides) {
      const { title, paras } = slideParagraphs(s.xml);
      const words = wordCount([title, ...paras].join(" "));
      totalWords += words;
      if (s.hidden) hidden++;
      for (const [f, n] of fontsUsed(s.xml)) fonts.set(f, (fonts.get(f) ?? 0) + n);
      const notes = (await notesText(zip, s.path)).text;
      if (notes) withNotes++;
      const images = await imagesOfPart(zip, s.path);
      let largest = 0; let largestName = "";
      for (const im of images) { const f = zip.file(im.path); if (!f) continue; const b = await f.async("uint8array"); if (b.length > largest) { largest = b.length; largestName = im.path.slice("ppt/media/".length); } if (b.length > 2 * 1024 * 1024) bigImages.push([s.index + 1, largestName, formatBytes(b.length)]); }
      const rels = await readRels(zip, s.path);
      const nLinks = rels.filter((r) => r.external && r.type === REL.hyperlink).length; links += nLinks;
      const empties = [...s.xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].filter((m) => /<p:ph\b/.test(m[0]) && !/<a:t>[^<]*\S[^<]*<\/a:t>/.test(m[0]) && !/<p:ph\b[^>]*type="(?:sldNum|dt|ftr|pic)"/.test(m[0])).length;
      emptyPh += empties;
      const flags: string[] = [];
      if (words > 120) flags.push("text-heavy");
      if (!title && !s.hidden) flags.push("no title");
      if (empties) flags.push("empty placeholder");
      if (largest > 2 * 1024 * 1024) flags.push("large picture");
      if (paras.length > 12) flags.push("many bullets");
      perSlide.push([s.index + 1, title, s.hidden ? "yes" : "", words, (s.xml.match(/<p:sp\b/g) ?? []).length, images.length, largest ? formatBytes(largest) : "", notes ? "yes" : "", nLinks, empties, flags.join(", ")]);
    }
    const fontRows: Row[] = [["Font", "Uses"], ...[...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, n] as Row)];
    const minutes = Math.round((totalWords / 130) * 10) / 10;
    const summary: Row[] = [["Deck", files[i].name], ["Slides", slides.length], ["Hidden slides", hidden], ["Slide size", sizeIn], ["Words on slides", totalWords], ["Estimated talk time (min, 130 wpm)", minutes], ["Slides with notes", withNotes], ["Hyperlinks", links], ["Empty placeholders", emptyPh], ["Pictures over 2 MB", bigImages.length - 1], ["Fonts used", fontRows.length - 1], ["Media size", formatBytes(mediaParts(zip, "ppt/media").reduce((a, p) => a + ((zip.file(p) as unknown as { _data?: { uncompressedSize?: number } })?._data?.uncompressedSize ?? 0), 0))]];
    outputs.push(xlsxFile(`${baseName(files[i].name)}-audit.xlsx`, [{ name: "Summary", rows: summary }, { name: "Slides", rows: perSlide }, { name: "Fonts", rows: fontRows }, { name: "Large pictures", rows: bigImages }]));
    summaryLines.push(`${files[i].name}: ${slides.length} slides, ${totalWords} words (~${minutes} min), ${hidden} hidden, ${withNotes} with notes, ${emptyPh} empty placeholders, ${fontRows.length - 1} fonts, ${bigImages.length - 1} large pictures`);
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, text: summaryLines.join("\n"), stats: { Decks: String(files.length) } };
};

export const compare: FileProcessor = async (files) => {
  if (files.length !== 2) throw new ProcessorError("Upload exactly two decks: the old and the new version");
  const [a, b] = await Promise.all(files.map(async (f) => { const zip = await openPackage(f, "pptx"); const slides = await listSlides(zip); const texts: { title: string; text: string }[] = []; for (const s of slides) { const { title, paras } = slideParagraphs(s.xml); const n = (await notesText(zip, s.path)).text; texts.push({ title, text: [title, ...paras, ...(n ? ["Notes: " + n] : [])].join("\n") }); } return texts; }));
  const rows: Row[] = [["Slide", "Old title", "New title", "Change", "Added lines", "Removed lines"]];
  const report: string[] = [];
  let changed = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const oa = a[i], ob = b[i];
    if (!oa) { rows.push([i + 1, "", ob.title, "added", ob.text.split("\n").length, 0]); changed++; report.push(`Slide ${i + 1}: added`); continue; }
    if (!ob) { rows.push([i + 1, oa.title, "", "removed", 0, oa.text.split("\n").length]); changed++; report.push(`Slide ${i + 1}: removed`); continue; }
    const ops = diffLines(oa.text, ob.text); const sum = diffSummary(ops);
    const change = sum.added + sum.removed === 0 ? "same" : "changed";
    if (change === "changed") { changed++; report.push(`Slide ${i + 1}${ob.title ? ` (${ob.title})` : ""}:`); for (const op of ops) if (op.type !== "same") report.push(`  ${op.type === "add" ? "+" : "-"} ${op.text}`); }
    rows.push([i + 1, oa.title, ob.title, change, sum.added, sum.removed]);
  }
  const text = changed ? report.join("\n") : "No text differences between the two decks.";
  return { files: [xlsxFile("deck-compare.xlsx", [{ name: "Slides", rows }]), fileFromText("deck-compare.txt", text)], text, data: { header: rows[0] as string[], rows: rows.slice(1) as (string | number)[][] }, stats: { "Slides (old/new)": `${a.length} / ${b.length}`, Changed: String(changed) } };
};

export const _internal = { xmlDecode, textOutput };
