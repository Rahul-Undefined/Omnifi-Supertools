import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, withSuffix, formatBytes } from "@/lib/utils";
import { parsePageRanges, parseRangeGroups } from "../shared/pages";
import { openPdf, closePdf, renderPage, pageText, pageLines } from "../shared/pdfjs";
import { canvasToBlob, blobToCanvas } from "../shared/canvas";
import { fileFromBytes, fileFromText, sizeStats, jsonOutput } from "../shared/output";
import { maybeZip } from "../shared/zip";
import { diffLines, formatDiff, diffSummary } from "../shared/diff";
import { toCsv } from "../shared/table";

const PDF = "application/pdf";

async function load(file: File, ignoreEncryption = false): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption, updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypted/i.test(msg)) throw new ProcessorError(`${file.name} is password protected`, "Remove the password first");
    throw new ProcessorError(`Could not read ${file.name}`, "The file may be damaged. Try PDF repair.");
  }
}

async function save(doc: PDFDocument, name: string): Promise<ProcessorFile> {
  const bytes = await doc.save({ useObjectStreams: true });
  return fileFromBytes(name, bytes, PDF);
}

const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export const merge: FileProcessor = async (files, { onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two PDFs to merge");
  const out = await PDFDocument.create();
  let pages = 0;
  let original = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const src = await load(files[i]);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    pages += copied.length;
    original += files[i].size;
    onProgress?.((i + 1) / files.length, `Added ${files[i].name}`);
  }
  const file = await save(out, "merged.pdf");
  return { files: [file], stats: { Files: String(files.length), Pages: String(pages), Original: formatBytes(original), Output: formatBytes(file.bytes) } };
};

export const split: FileProcessor = async (files, { options, onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  for (const file of files) {
    const src = await load(file);
    const total = src.getPageCount();
    const mode = String(options.mode ?? "every");
    let groups: [number, number][];
    if (mode === "ranges") groups = parseRangeGroups(String(options.ranges ?? ""), total);
    else if (mode === "chunks") {
      const size = Math.max(1, Number(options.chunk) || 1);
      groups = [];
      for (let s = 1; s <= total; s += size) groups.push([s, Math.min(total, s + size - 1)]);
    } else groups = Array.from({ length: total }, (_, i) => [i + 1, i + 1]);

    for (let g = 0; g < groups.length; g++) {
      throwIfAborted(signal);
      const [a, b] = groups[g];
      const doc = await PDFDocument.create();
      const idx = Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
      const pages = await doc.copyPages(src, idx);
      pages.forEach((p) => doc.addPage(p));
      const label = a === b ? `page-${a}` : `pages-${a}-${b}`;
      outputs.push(await save(doc, `${baseName(file.name)}-${label}.pdf`));
      onProgress?.((g + 1) / groups.length, `${file.name}: ${label}`);
    }
  }
  return { files: await maybeZip(outputs, `${baseName(files[0].name)}-split.zip`), stats: { Parts: String(outputs.length) } };
};

export const compress: FileProcessor = async (files, { options, onProgress, signal }) => {
  const level = String(options.level ?? "lossless");
  const outputs: ProcessorFile[] = [];
  let original = 0;
  let output = 0;
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    original += file.size;
    let result: ProcessorFile;
    if (level === "lossless") {
      const doc = await load(file);
      // Re-serialise with object streams; drops unused objects and incremental-update cruft.
      result = await save(doc, withSuffix(file.name, "-compressed"));
    } else {
      const scale = level === "strong" ? 80 / 72 : 110 / 72;
      const quality = level === "strong" ? 0.55 : 0.7;
      const src = await openPdf(file);
      const doc = await PDFDocument.create();
      for (let p = 1; p <= src.numPages; p++) {
        throwIfAborted(signal);
        const canvas = await renderPage(src, p, scale);
        const jpg = await canvasToBlob(canvas, "image/jpeg", quality);
        const img = await doc.embedJpg(await jpg.arrayBuffer());
        const vp = (await src.getPage(p)).getViewport({ scale: 1 });
        const pg = doc.addPage([vp.width, vp.height]);
        pg.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
        onProgress?.((fi + p / src.numPages) / files.length, `${file.name}: page ${p}/${src.numPages}`);
      }
      await closePdf(src);
      result = await save(doc, withSuffix(file.name, "-compressed"));
    }
    // Never hand back a bigger file than we received.
    if (result.bytes >= file.size) {
      result = { name: withSuffix(file.name, "-compressed"), blob: file, bytes: file.size, mime: PDF };
    }
    output += result.bytes;
    outputs.push(result);
    onProgress?.((fi + 1) / files.length);
  }
  const warnings = output >= original ? ["This PDF is already well optimised; no further reduction was possible with this setting. Try Balanced or Strong."] : undefined;
  return { files: outputs, stats: sizeStats(original, output), warnings };
};

export const rotate: FileProcessor = async (files, { options, onProgress }) => {
  const angle = Number(options.angle ?? 90);
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const doc = await load(files[i]);
    const idx = parsePageRanges(String(options.pages ?? ""), doc.getPageCount());
    for (const p of idx) {
      const page = doc.getPage(p);
      page.setRotation(degrees((page.getRotation().angle + angle) % 360));
    }
    outputs.push(await save(doc, withSuffix(files[i].name, "-rotated")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

export const extractPages: FileProcessor = async (files, { options, onProgress }) => {
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const src = await load(files[i]);
    const idx = parsePageRanges(String(options.pages ?? ""), src.getPageCount());
    if (!idx.length) throw new ProcessorError("Choose at least one page");
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
    outputs.push(await save(doc, withSuffix(files[i].name, "-pages")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

export const deletePages: FileProcessor = async (files, { options, onProgress }) => {
  const outputs: ProcessorFile[] = [];
  let removed = 0;
  for (let i = 0; i < files.length; i++) {
    const doc = await load(files[i]);
    const total = doc.getPageCount();
    const del = new Set(parsePageRanges(String(options.pages ?? ""), total));
    if (del.size >= total) throw new ProcessorError("You cannot delete every page");
    for (let p = total - 1; p >= 0; p--) if (del.has(p)) doc.removePage(p);
    removed += del.size;
    outputs.push(await save(doc, withSuffix(files[i].name, "-edited")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { "Pages removed": String(removed) } };
};

const PAGE_SIZES: Record<string, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

export const fromImages: FileProcessor = async (files, { options, onProgress, signal }) => {
  if (!files.length) throw new ProcessorError("Add at least one image");
  const doc = await PDFDocument.create();
  const margin = Number(options.margin ?? 0);
  const sizeKey = String(options.pageSize ?? "fit");
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const f = files[i];
    let bytes = await f.arrayBuffer();
    let type = f.type;
    if (type !== "image/jpeg" && type !== "image/png") {
      // Normalise anything else (webp, bmp, gif) to PNG via canvas.
      const { canvas } = await blobToCanvas(f);
      bytes = await (await canvasToBlob(canvas, "image/png")).arrayBuffer();
      type = "image/png";
    }
    const img = type === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    let [pw, ph] = sizeKey === "fit" ? [img.width + margin * 2, img.height + margin * 2] : PAGE_SIZES[sizeKey];
    if (sizeKey !== "fit" && img.width > img.height && pw < ph) [pw, ph] = [ph, pw];
    const page = doc.addPage([pw, ph]);
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, sizeKey === "fit" ? 1 : Infinity);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    onProgress?.((i + 1) / files.length, f.name);
  }
  const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf";
  const file = await save(doc, name);
  return { files: [file], stats: { Pages: String(files.length), Output: formatBytes(file.bytes) } };
};

export const toImages: FileProcessor = async (files, { options, onProgress, signal }) => {
  const format = String(options.format ?? "jpeg") === "png" ? "image/png" : "image/jpeg";
  const ext = format === "image/png" ? "png" : "jpg";
  const scale = Number(options.scale ?? 2);
  const quality = Number(options.quality ?? 0.9);
  const outputs: ProcessorFile[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    const doc = await openPdf(files[fi]);
    const pages = parsePageRanges(String(options.pages ?? ""), doc.numPages);
    for (let k = 0; k < pages.length; k++) {
      throwIfAborted(signal);
      const p = pages[k] + 1;
      const canvas = await renderPage(doc, p, scale);
      const blob = await canvasToBlob(canvas, format, quality);
      outputs.push({ name: `${baseName(files[fi].name)}-page-${p}.${ext}`, blob, bytes: blob.size, mime: format });
      onProgress?.((fi + (k + 1) / pages.length) / files.length, `Page ${p}/${doc.numPages}`);
    }
    await closePdf(doc);
  }
  return { files: await maybeZip(outputs, `${baseName(files[0].name)}-images.zip`), stats: { Images: String(outputs.length) } };
};

export const extractText: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  let all = "";
  for (let fi = 0; fi < files.length; fi++) {
    const doc = await openPdf(files[fi]);
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      throwIfAborted(signal);
      parts.push(await pageText(doc, p));
      onProgress?.((fi + p / doc.numPages) / files.length, `Page ${p}/${doc.numPages}`);
    }
    await closePdf(doc);
    const text = parts.join("\n\n");
    all += (files.length > 1 ? `===== ${files[fi].name} =====\n` : "") + text + "\n";
    outputs.push(fileFromText(`${baseName(files[fi].name)}.txt`, text));
  }
  const warnings = all.trim().length < 20 ? ["Very little text was found. This may be a scanned PDF; try OCR."] : undefined;
  return { files: outputs, text: all.trim(), stats: { Characters: all.length.toLocaleString() }, warnings };
};

export const extractTables: FileProcessor = async (files, { options, onProgress }) => {
  const minCols = Math.max(2, Number(options.minColumns ?? 2));
  const outputs: ProcessorFile[] = [];
  let rowsTotal = 0;
  for (let fi = 0; fi < files.length; fi++) {
    const doc = await openPdf(files[fi]);
    const rows: string[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const lines = await pageLines(doc, p);
      for (const line of lines) {
        // Merge items that are close together into one cell; gaps > 12pt start a new cell.
        const cells: string[] = [];
        let lastEnd = -Infinity;
        for (const item of line) {
          if (item.x - lastEnd > 12 || !cells.length) cells.push(item.str.trim());
          else cells[cells.length - 1] += " " + item.str.trim();
          lastEnd = item.x + item.str.length * 4.5;
        }
        if (cells.length >= minCols) rows.push(cells);
      }
      onProgress?.((fi + p / doc.numPages) / files.length);
    }
    await closePdf(doc);
    rowsTotal += rows.length;
    outputs.push(fileFromText(`${baseName(files[fi].name)}-tables.csv`, toCsv(rows), "text/csv"));
  }
  if (!rowsTotal) throw new ProcessorError("No table-like rows found", "The PDF may be scanned. Run OCR first, or lower the minimum columns.");
  return { files: outputs, stats: { Rows: String(rowsTotal) }, warnings: ["Table detection is heuristic. Check column alignment in the CSV."] };
};

export const ocr: FileProcessor = async (files, { options, onProgress, signal }) => {
  const { createWorker } = await import("tesseract.js");
  const lang = String(options.lang ?? "eng");
  const scale = Number(options.scale ?? 2);
  onProgress?.(0.01, "Loading OCR engine");
  // Worker, WebAssembly core and language data are all served by this app (public/tesseract, public/tessdata).
  const worker = await createWorker(lang, 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tessdata",
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") onProgress?.(Math.min(0.99, 0.1 + m.progress * 0.85), "Recognizing");
      else if (m.status && m.status !== "recognizing text") onProgress?.(0.05, m.status);
    },
  });
  try {
    const outputs: ProcessorFile[] = [];
    let all = "";
    for (const file of files) {
      throwIfAborted(signal);
      const images: Blob[] = [];
      if (file.type === PDF || file.name.toLowerCase().endsWith(".pdf")) {
        const doc = await openPdf(file);
        for (let p = 1; p <= doc.numPages; p++) images.push(await canvasToBlob(await renderPage(doc, p, scale), "image/png"));
        await closePdf(doc);
      } else images.push(file);
      const parts: string[] = [];
      for (let i = 0; i < images.length; i++) {
        throwIfAborted(signal);
        const { data } = await worker.recognize(images[i]);
        parts.push(data.text.trim());
      }
      const text = parts.join("\n\n");
      all += (files.length > 1 ? `===== ${file.name} =====\n` : "") + text + "\n";
      outputs.push(fileFromText(`${baseName(file.name)}-ocr.txt`, text));
    }
    return { files: outputs, text: all.trim(), stats: { Characters: all.length.toLocaleString() } };
  } finally {
    await worker.terminate();
  }
};

export const watermark: FileProcessor = async (files, { options, onProgress }) => {
  const text = String(options.text ?? "CONFIDENTIAL") || "CONFIDENTIAL";
  const opacity = Number(options.opacity ?? 0.2);
  const size = Number(options.size ?? 60);
  const angle = Number(options.angle ?? 45);
  const margin = Number(options.margin ?? 36);
  const position = String(options.position ?? "center");
  const color = hexToRgb(String(options.color ?? "#4F5BD5"));
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const doc = await load(files[i]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const tw = font.widthOfTextAtSize(text, size);
    const th = font.heightAtSize(size);
    const rad = (angle * Math.PI) / 180;
    // Bounding box of the rotated text, so edge positions stay inside the page.
    const bw = Math.abs(tw * Math.cos(rad)) + Math.abs(th * Math.sin(rad));
    const bh = Math.abs(tw * Math.sin(rad)) + Math.abs(th * Math.cos(rad));
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const place = (cx: number, cy: number) => {
        // pdf-lib rotates around the text origin (baseline start); offset so the text is centred on (cx, cy).
        const x = cx - (tw / 2) * Math.cos(rad) + (th / 2) * Math.sin(rad);
        const y = cy - (tw / 2) * Math.sin(rad) - (th / 2) * Math.cos(rad);
        page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(angle) });
      };
      if (position === "tile") {
        const stepX = bw + size * 1.5;
        const stepY = bh + size * 1.5;
        for (let y = bh / 2; y < height + bh; y += stepY) for (let x = bw / 2; x < width + bw; x += stepX) place(x, y);
        continue;
      }
      const [v, h] = position === "center" ? ["center", "center"] : position.split("-");
      const cx = h === "left" ? margin + bw / 2 : h === "right" ? width - margin - bw / 2 : width / 2;
      const cy = v === "top" ? height - margin - bh / 2 : v === "bottom" ? margin + bh / 2 : height / 2;
      place(cx, cy);
    }
    outputs.push(await save(doc, withSuffix(files[i].name, "-watermarked")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

export const pageNumbers: FileProcessor = async (files, { options, onProgress }) => {
  const fmt = String(options.format ?? "{n} / {total}");
  const position = String(options.position ?? "bottom-center");
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const doc = await load(files[i]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    pages.forEach((page, idx) => {
      const label = fmt.replace("{n}", String(idx + 1)).replace("{total}", String(pages.length));
      const { width, height } = page.getSize();
      const tw = font.widthOfTextAtSize(label, 10);
      const x = position.endsWith("right") ? width - tw - 36 : width / 2 - tw / 2;
      const y = position.startsWith("top") ? height - 30 : 24;
      page.drawText(label, { x, y, size: 10, font, color: rgb(0.17, 0.2, 0.5) });
    });
    outputs.push(await save(doc, withSuffix(files[i].name, "-numbered")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

export const metadata: FileProcessor = async (files, { options }) => {
  const results: Record<string, unknown>[] = [];
  const outputs: ProcessorFile[] = [];
  for (const file of files) {
    const doc = await load(file, true);
    const info = {
      file: file.name,
      pages: doc.getPageCount(),
      title: doc.getTitle() ?? "",
      author: doc.getAuthor() ?? "",
      subject: doc.getSubject() ?? "",
      keywords: doc.getKeywords() ?? "",
      creator: doc.getCreator() ?? "",
      producer: doc.getProducer() ?? "",
      created: doc.getCreationDate()?.toISOString() ?? "",
      modified: doc.getModificationDate()?.toISOString() ?? "",
      size: formatBytes(file.size),
    };
    results.push(info);
    if (options.edit) {
      if (options.title !== undefined) doc.setTitle(String(options.title));
      if (options.author !== undefined) doc.setAuthor(String(options.author));
      if (options.subject !== undefined) doc.setSubject(String(options.subject));
      if (options.keywords !== undefined) doc.setKeywords(String(options.keywords).split(",").map((k) => k.trim()).filter(Boolean));
      doc.setModificationDate(new Date());
      outputs.push(await save(doc, withSuffix(file.name, "-metadata")));
    }
  }
  const out = jsonOutput(results.length === 1 ? results[0] : results);
  out.files = outputs;
  return out;
};

export const compare: FileProcessor = async (files, { onProgress }) => {
  if (files.length !== 2) throw new ProcessorError("Upload exactly two PDFs");
  const texts: string[] = [];
  for (let i = 0; i < 2; i++) {
    const doc = await openPdf(files[i]);
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) parts.push(await pageText(doc, p));
    await closePdf(doc);
    texts.push(parts.join("\n"));
    onProgress?.((i + 1) / 2);
  }
  const ops = diffLines(texts[0], texts[1]);
  const s = diffSummary(ops);
  const text = formatDiff(ops);
  return {
    files: [fileFromText("comparison.diff.txt", text)],
    text,
    data: ops,
    stats: { Added: String(s.added), Removed: String(s.removed), Unchanged: String(s.unchanged) },
  };
};

export { protect, unlock, sign, flatten, formFields, redactText, splitSmart } from "./advanced";

export const repair: FileProcessor = async (files, { onProgress }) => {
  const outputs: ProcessorFile[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
      outputs.push(await save(doc, withSuffix(file.name, "-repaired")));
    } catch {
      // Fall back to rendering through pdf.js (more tolerant) into a fresh PDF.
      try {
        const src = await openPdf(file);
        const doc = await PDFDocument.create();
        for (let p = 1; p <= src.numPages; p++) {
          const canvas = await renderPage(src, p, 1.5);
          const png = await canvasToBlob(canvas, "image/png");
          const img = await doc.embedPng(await png.arrayBuffer());
          const vp = (await src.getPage(p)).getViewport({ scale: 1 });
          doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
        }
        await closePdf(src);
        outputs.push(await save(doc, withSuffix(file.name, "-repaired")));
        warnings.push(`${file.name}: structure could not be recovered, pages were re-rendered as images.`);
      } catch {
        throw new ProcessorError(`${file.name} could not be repaired`, "The file is too damaged to parse.");
      }
    }
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, warnings: warnings.length ? warnings : undefined };
};
export { extractImages as extractPdfImages, toEpub } from "./extra";
