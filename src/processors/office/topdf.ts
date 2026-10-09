import JSZip from "jszip";
import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { readSheets, cellText } from "../shared/table";
import { fileFromBytes } from "../shared/output";
import { PdfWriter, NAVY, MUTED, resetStripped, strippedChars, safeText } from "../shared/pdfwriter";

/**
 * Browser-side Office → PDF. These do not need LibreOffice: they parse the
 * OOXML directly and lay the content out with pdf-lib. Text, tables, headings,
 * lists, images and slide geometry are preserved; exotic formatting is not.
 */

const PDF = "application/pdf";
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function openZip(file: File): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ProcessorError(`${file.name} is not a valid Office file`, "Only .docx, .xlsx and .pptx (Office 2007+) are supported.");
  }
}

function finish(name: string, bytes: Uint8Array, pages: number): ProcessorFile & { pages: number } {
  return { ...fileFromBytes(name, bytes, PDF), pages };
}

const warnStripped = (): string[] | undefined =>
  strippedChars() > 0 ? [`${strippedChars()} characters outside the Latin range (for example non-Latin scripts or emoji) were replaced with "?". Standard PDF fonts only cover Latin text.`] : undefined;

/* ---------------- Excel ---------------- */

export const excelToPdf: FileProcessor = async (files, { options, onProgress, signal }) => {
  resetStripped();
  const outputs: ProcessorFile[] = [];
  let pages = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = await readSheets(files[i]);
    const widest = Math.max(1, ...sheets.map((s) => Math.max(0, ...s.rows.map((r) => r.length))));
    const landscape = String(options.orientation ?? "auto") === "landscape" || (String(options.orientation ?? "auto") === "auto" && widest > 6);
    const pw = await PdfWriter.create({ landscape, margin: 40 });
    let first = true;
    for (const s of sheets) {
      if (!s.rows.length) continue;
      if (!first) pw.addPage();
      first = false;
      pw.text(s.name, { size: 14, bold: true, color: NAVY, spaceAfter: 6 });
      const maxRows = Number(options.maxRows ?? 5000);
      const rows = s.rows.slice(0, maxRows).map((r) => r.map((c) => formatCell(c)));
      pw.table(rows, { header: options.headerRow !== false, fontSize: widest > 10 ? 7 : 8.5 });
      if (s.rows.length > maxRows) pw.text(`… ${s.rows.length - maxRows} more rows not printed`, { size: 8, color: MUTED });
    }
    if (first) throw new ProcessorError(`${files[i].name} has no data`);
    pw.footer(files[i].name);
    const out = finish(`${baseName(files[i].name)}.pdf`, await pw.save(), pw.pageCount);
    pages += out.pages;
    outputs.push(out);
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return { files: outputs, stats: { Pages: String(pages), Output: formatBytes(outputs.reduce((a, f) => a + f.bytes, 0)) }, warnings: warnStripped() };
};

function formatCell(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : c.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return cellText(c as string);
}

/* ---------------- Word ---------------- */

interface DocxPara { text: string; style: string; runsBold: boolean; numbered: boolean; bullet: boolean; images: string[] }

function parseDocx(xml: string): { paras: DocxPara[]; tables: Map<number, string[][]> } {
  // Walk body children in order: paragraphs and tables. Tables are flattened to rows.
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const paras: DocxPara[] = [];
  const tables = new Map<number, string[][]>();
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl>")) {
      const rows = [...chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => paraText(c[0]).replace(/\n+/g, " ").trim()),
      );
      tables.set(paras.length, rows);
      paras.push({ text: "", style: "__table__", runsBold: false, numbered: false, bullet: false, images: [] });
      continue;
    }
    const style = chunk.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const numbered = /<w:numPr>/.test(chunk);
    const images = [...chunk.matchAll(/r:embed="([^"]+)"/g)].map((x) => x[1]);
    const text = paraText(chunk);
    const runs = [...chunk.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)];
    const runsBold = runs.length > 0 && runs.every((r) => /<w:b\b/.test(r[0]) || !/<w:t/.test(r[0]));
    paras.push({ text, style, runsBold, numbered, bullet: numbered && /ListBullet|Bullet/i.test(style), images });
  }
  return { paras, tables };
}

function paraText(chunk: string): string {
  return decodeXml(
    chunk
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n$/, "");
}

async function relsMedia(zip: JSZip, relsPath: string, mediaBase: string): Promise<Map<string, { bytes: Uint8Array; mime: string }>> {
  const map = new Map<string, { bytes: Uint8Array; mime: string }>();
  const rels = await zip.file(relsPath)?.async("string");
  if (!rels) return map;
  for (const r of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    const [, id, target] = r;
    if (!/\.(png|jpe?g)$/i.test(target)) continue;
    const path = target.startsWith("/") ? target.slice(1) : `${mediaBase}/${target}`.replace(/\/\.\.\//g, "/").replace(/^([^/]+)\/\.\.\//, "");
    const normalized = path.split("/").reduce<string[]>((acc, seg) => { if (seg === "..") acc.pop(); else if (seg !== ".") acc.push(seg); return acc; }, []).join("/");
    const f = zip.file(normalized);
    if (!f) continue;
    map.set(id, { bytes: await f.async("uint8array"), mime: /\.png$/i.test(normalized) ? "image/png" : "image/jpeg" });
  }
  return map;
}

export const docxToPdf: FileProcessor = async (files, { onProgress, signal }) => {
  resetStripped();
  const outputs: ProcessorFile[] = [];
  let pages = 0;
  let imagesEmbedded = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openZip(files[i]);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new ProcessorError(`${files[i].name} has no document body`);
    const { paras, tables } = parseDocx(xml);
    const media = await relsMedia(zip, "word/_rels/document.xml.rels", "word");
    const pw = await PdfWriter.create();
    let listIndex = 0;
    for (let p = 0; p < paras.length; p++) {
      const para = paras[p];
      if (para.style === "__table__") {
        const rows = tables.get(p) ?? [];
        if (rows.length) pw.table(rows, { header: true, fontSize: 9 });
        continue;
      }
      for (const id of para.images) {
        const m = media.get(id);
        if (m && (await pw.image(m.bytes, m.mime))) imagesEmbedded++;
      }
      if (!para.text.trim()) { pw.space(6); continue; }
      const h = para.style.match(/^Heading(\d)|^Title$/i);
      if (/^Title$/i.test(para.style)) pw.text(para.text, { size: 24, bold: true, color: NAVY, spaceAfter: 10 });
      else if (h) {
        const level = Number(h[1] ?? 1);
        pw.text(para.text, { size: [20, 16, 14, 12, 11, 11][Math.min(5, level - 1)], bold: true, color: NAVY, spaceAfter: 6 });
        listIndex = 0;
      } else if (para.numbered) {
        listIndex = para.bullet ? 0 : listIndex + 1;
        const marker = para.bullet ? "•" : `${listIndex}.`;
        pw.text(`${marker}  ${para.text}`, { size: 11, indent: 18, bold: para.runsBold });
      } else {
        listIndex = 0;
        pw.text(para.text, { size: 11, bold: para.runsBold });
      }
    }
    pw.footer(files[i].name);
    const out = finish(`${baseName(files[i].name)}.pdf`, await pw.save(), pw.pageCount);
    pages += out.pages;
    outputs.push(out);
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  const warnings = [...(warnStripped() ?? []), "Layout is reflowed: headings, paragraphs, lists, tables and images are kept; page geometry, fonts, headers and footers are not."];
  return { files: outputs, stats: { Pages: String(pages), Images: String(imagesEmbedded) }, warnings };
};

/* ---------------- PowerPoint ---------------- */

const EMU = 12700; // EMUs per point

interface Shape { kind: "text" | "image"; x: number; y: number; w: number; h: number; text?: string; isTitle?: boolean; rId?: string; size?: number }

function parseSlide(xml: string): Shape[] {
  const shapes: Shape[] = [];
  const box = (s: string) => {
    const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = s.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!off || !ext) return null;
    return { x: Number(off[1]) / EMU, y: Number(off[2]) / EMU, w: Number(ext[1]) / EMU, h: Number(ext[2]) / EMU };
  };
  for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const s = m[0];
    const b = box(s);
    const paras = [...s.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => {
      const bullet = /<a:buChar|<a:buAutoNum/.test(p[0]) && !/<a:buNone/.test(p[0]);
      const lvl = Number(p[0].match(/<a:pPr[^>]*lvl="(\d)"/)?.[1] ?? 0);
      const t = decodeXml([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join(""));
      return t.trim() ? `${"   ".repeat(lvl)}${bullet ? "• " : ""}${t}` : "";
    });
    const text = paras.filter((p) => p !== "").join("\n");
    if (!text.trim()) continue;
    const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(s);
    const sz = Number(s.match(/<a:rPr[^>]*sz="(\d+)"/)?.[1] ?? 0) / 100;
    shapes.push({ kind: "text", ...(b ?? { x: 36, y: 36, w: 888, h: 60 }), text, isTitle, size: sz || undefined });
  }
  for (const m of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const b = box(m[0]);
    const rId = m[0].match(/r:embed="([^"]+)"/)?.[1];
    if (b && rId) shapes.push({ kind: "image", ...b, rId });
  }
  return shapes;
}

export const pptxToPdf: FileProcessor = async (files, { options, onProgress, signal }) => {
  resetStripped();
  const outputs: ProcessorFile[] = [];
  let totalSlides = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const zip = await openZip(files[i]);
    const pres = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
    const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    const slideW = sz ? Number(sz[1]) / EMU : 960;
    const slideH = sz ? Number(sz[2]) / EMU : 540;
    const order = [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
    const presRels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "";
    const slidePaths = order
      .map((id) => presRels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1] ?? presRels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1])
      .filter((p): p is string => Boolean(p))
      .map((p) => `ppt/${p.replace(/^\/?ppt\//, "").replace(/^\//, "")}`);
    const slides = slidePaths.length ? slidePaths : Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (!slides.length) throw new ProcessorError(`${files[i].name} contains no slides`);

    const pw = await PdfWriter.create({ width: slideW, height: slideH, margin: 0 });
    pw.doc.removePage(0);
    pw.pageCount = 0;
    const scale = 1;
    for (let k = 0; k < slides.length; k++) {
      throwIfAborted(signal);
      const path = slides[k];
      const xml = (await zip.file(path)?.async("string")) ?? "";
      const shapes = parseSlide(xml);
      const media = await relsMedia(zip, path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"), "ppt/slides");
      pw.addPage();
      // Background: white; slide number bottom-right.
      for (const s of shapes.filter((s) => s.kind === "image")) {
        const m = media.get(s.rId!);
        if (m) await pw.imageAt(m.bytes, m.mime, s.x * scale, slideH - s.y * scale, s.w * scale, s.h * scale);
      }
      for (const s of shapes.filter((s) => s.kind === "text")) {
        const size = s.size ?? (s.isTitle ? 30 : 16);
        pw.textBox(s.text!, s.x * scale + 4, slideH - s.y * scale - 4, Math.max(20, s.w * scale - 8), Math.max(10, s.h * scale), { size: Math.min(size, s.isTitle ? 40 : 28), bold: s.isTitle, color: NAVY });
      }
      if (options.slideNumbers !== false) pw.page.drawText(safeText(`${k + 1} / ${slides.length}`), { x: slideW - 60, y: 14, size: 9, font: pw.font(), color: MUTED });
      onProgress?.((i + (k + 1) / slides.length) / files.length, `Slide ${k + 1}/${slides.length}`);
    }
    totalSlides += slides.length;
    outputs.push(finish(`${baseName(files[i].name)}.pdf`, await pw.save(), slides.length));
  }
  const warnings = [...(warnStripped() ?? []), "Slides are rebuilt from their text and images at their original positions; theme backgrounds, shapes and charts are not drawn."];
  return { files: outputs, stats: { Slides: String(totalSlides), Output: formatBytes(outputs.reduce((a, f) => a + f.bytes, 0)) }, warnings };
};
