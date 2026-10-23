import JSZip from "jszip";
import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { openPdf, closePdf, getPdfjs, pageLines } from "../shared/pdfjs";
import { zipFiles } from "../shared/zip";
import { makeCanvas, ctx2d, canvasToBlob } from "../shared/canvas";

/* ---------- Extract embedded images from a PDF ---------- */

export const extractImages: FileProcessor = async (files, { options, onProgress, signal }) => {
  const pdfjs = await getPdfjs();
  const minPx = Number(options.minSize ?? 64);
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const doc = await openPdf(files[i]);
    const seen = new Set<string>();
    let n = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      throwIfAborted(signal);
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();
      const names = new Set<string>();
      for (let k = 0; k < ops.fnArray.length; k++) {
        if (ops.fnArray[k] === pdfjs.OPS.paintImageXObject || ops.fnArray[k] === pdfjs.OPS.paintInlineImageXObject) names.add(String(ops.argsArray[k][0]));
      }
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        let img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array; kind?: number; bitmap?: ImageBitmap } | null = null;
        try {
          img = await new Promise((resolve) => { try { page.objs.get(name, (o: unknown) => resolve(o as typeof img)); } catch { resolve(null); } });
        } catch { img = null; }
        if (!img || !img.width || img.width < minPx || img.height < minPx) continue;
        const c = makeCanvas(img.width, img.height);
        const g = ctx2d(c) as CanvasRenderingContext2D;
        if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
        else if (img.data) {
          const out = g.createImageData(img.width, img.height);
          const d = img.data;
          const bpp = d.length / (img.width * img.height);
          for (let px = 0; px < img.width * img.height; px++) {
            if (bpp === 4) { out.data[px * 4] = d[px * 4]; out.data[px * 4 + 1] = d[px * 4 + 1]; out.data[px * 4 + 2] = d[px * 4 + 2]; out.data[px * 4 + 3] = d[px * 4 + 3]; }
            else if (bpp === 3) { out.data[px * 4] = d[px * 3]; out.data[px * 4 + 1] = d[px * 3 + 1]; out.data[px * 4 + 2] = d[px * 3 + 2]; out.data[px * 4 + 3] = 255; }
            else { const v = d[Math.floor(px * bpp)]; out.data[px * 4] = v; out.data[px * 4 + 1] = v; out.data[px * 4 + 2] = v; out.data[px * 4 + 3] = 255; }
          }
          g.putImageData(out, 0, 0);
        } else continue;
        const mime = String(options.format ?? "image/png");
        const blob = await canvasToBlob(c, mime, mime === "image/jpeg" ? 0.92 : undefined);
        n++;
        outputs.push({ name: `${files.length > 1 ? baseName(files[i].name) + "/" : ""}page${p}-image${n}.${mime === "image/jpeg" ? "jpg" : "png"}`, blob, bytes: blob.size, mime });
      }
      page.cleanup();
      onProgress?.((i + p / doc.numPages) / files.length, `Page ${p}`);
    }
    await closePdf(doc);
  }
  if (!outputs.length) throw new ProcessorError("No embedded images found", "Scanned PDFs made of one full-page image are included; vector drawings and text are not images.");
  return { files: [await zipFiles(outputs, files.length === 1 ? `${baseName(files[0].name)}-images.zip` : "pdf-images.zip", 0)], stats: { Images: String(outputs.length), Size: formatBytes(outputs.reduce((a, f) => a + f.bytes, 0)) } };
};

/* ---------- PDF to EPUB ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const toEpub: FileProcessor = async (files, { options, onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  const chapterMode = String(options.chapters ?? "pages");
  const perChapter = Math.max(1, Number(options.pagesPerChapter ?? 1));
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const doc = await openPdf(files[i]);
    const title = String(options.title ?? "").trim() || baseName(files[i].name);
    const author = String(options.author ?? "").trim() || "Omnifi SuperTools";
    // Collect paragraphs per page using line geometry: a gap larger than 1.5x the line height starts a new paragraph.
    const pages: string[][] = [];
    let total = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      throwIfAborted(signal);
      const lines = await pageLines(doc, p);
      const paras: string[] = [];
      let cur = "";
      for (const line of lines) {
        const text = line.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim();
        if (!text) { if (cur) { paras.push(cur); cur = ""; } continue; }
        const endsSentence = /[.!?:"”)]$/.test(cur);
        const startsUpper = /^[A-Z0-9"“(•\-–]/.test(text);
        if (cur && endsSentence && startsUpper && cur.length > 60) { paras.push(cur); cur = text; }
        else cur = cur ? `${cur.replace(/-$/, "")}${/-$/.test(cur) ? "" : " "}${text}` : text;
      }
      if (cur) paras.push(cur);
      total += paras.reduce((a, s) => a + s.length, 0);
      pages.push(paras);
      onProgress?.((i + (p / doc.numPages) * 0.8) / files.length, `Page ${p}`);
    }
    await closePdf(doc);
    if (total < 50) throw new ProcessorError(`${files[i].name} has no text layer`, "Run OCR first, then convert the OCR'd PDF.");

    // Chapters: by page groups, or by detected headings (short lines in Title Case).
    const chapters: { title: string; paras: string[] }[] = [];
    if (chapterMode === "headings") {
      let current: { title: string; paras: string[] } = { title, paras: [] };
      for (const paras of pages) for (const para of paras) {
        const isHeading = para.length < 70 && !/[.,;:]$/.test(para) && /^[A-Z0-9]/.test(para) && para.split(" ").length <= 10;
        if (isHeading && current.paras.length) { chapters.push(current); current = { title: para, paras: [] }; }
        else if (isHeading && !current.paras.length) current.title = para;
        else current.paras.push(para);
      }
      chapters.push(current);
    } else {
      for (let p = 0; p < pages.length; p += perChapter) {
        const group = pages.slice(p, p + perChapter).flat();
        chapters.push({ title: perChapter === 1 ? `Page ${p + 1}` : `Pages ${p + 1}–${Math.min(pages.length, p + perChapter)}`, paras: group });
      }
    }
    const kept = chapters.filter((c) => c.paras.length);
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    const uid = `urn:uuid:${crypto.randomUUID()}`;
    const css = "body{font-family:serif;line-height:1.5;margin:1em}h1{font-size:1.4em;margin:1em 0 .6em}p{margin:0 0 .8em;text-align:justify}";
    zip.file("OEBPS/style.css", css);
    const xhtml = (c: { title: string; paras: string[] }) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${esc(c.title)}</h1>${c.paras.map((p) => `<p>${esc(p)}</p>`).join("\n")}</body></html>`;
    kept.forEach((c, k) => zip.file(`OEBPS/ch${k + 1}.xhtml`, xhtml(c)));
    const nav = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${kept.map((c, k) => `<li><a href="ch${k + 1}.xhtml">${esc(c.title)}</a></li>`).join("")}</ol></nav></body></html>`;
    zip.file("OEBPS/nav.xhtml", nav);
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${kept.map((c, k) => `<navPoint id="np${k + 1}" playOrder="${k + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="ch${k + 1}.xhtml"/></navPoint>`).join("")}</navMap></ncx>`;
    zip.file("OEBPS/toc.ncx", ncx);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${esc(String(options.language ?? "en"))}</dc:language><meta property="dcterms:modified">${now}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${kept.map((_, k) => `<item id="ch${k + 1}" href="ch${k + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine toc="ncx">${kept.map((_, k) => `<itemref idref="ch${k + 1}"/>`).join("")}</spine></package>`;
    zip.file("OEBPS/content.opf", opf);
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
    outputs.push({ name: `${baseName(files[i].name)}.epub`, blob, bytes: blob.size, mime: "application/epub+zip" });
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { Books: String(outputs.length) }, warnings: ["Text is reflowed from the PDF's text layer; page images, tables and exact layout are not preserved. Scanned PDFs need OCR first."] };
};
