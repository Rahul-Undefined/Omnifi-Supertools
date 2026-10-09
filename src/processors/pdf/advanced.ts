import { PDFDocument, degrees, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "pdf-lib";
import type { FileProcessor, ProcessorFile, ProcessorOutput } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, withSuffix, formatBytes } from "@/lib/utils";
import { openPdf, closePdf, renderPage, pageText } from "../shared/pdfjs";
import { canvasToBlob, ctx2d, blobToCanvas } from "../shared/canvas";
import { fileFromBytes, jsonOutput } from "../shared/output";
import { maybeZip } from "../shared/zip";
import { parseDate } from "../shared/dates";

const PDF = "application/pdf";

async function load(file: Blob, name = "file"): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new ProcessorError(`Could not read ${name}`, "The file may be damaged or password protected.");
  }
}

const save = async (doc: PDFDocument, name: string): Promise<ProcessorFile> => fileFromBytes(name, await doc.save({ useObjectStreams: true }), PDF);

/* ---------------- Password protection (AES-256 via pdf-lib-plus-encrypt) ---------------- */

export const protect: FileProcessor = async (files, { options, onProgress }) => {
  const userPassword = String(options.password ?? "");
  if (userPassword.length < 4) throw new ProcessorError("Enter a password of at least 4 characters");
  const ownerPassword = String(options.ownerPassword ?? "") || userPassword;
  const { PDFDocument: EncDoc } = await import("pdf-lib-plus-encrypt");
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    let doc;
    try {
      doc = await EncDoc.load(await files[i].arrayBuffer(), { ignoreEncryption: true });
    } catch {
      throw new ProcessorError(`Could not read ${files[i].name}`);
    }
    await doc.encrypt({
      userPassword,
      ownerPassword,
      permissions: {
        printing: options.allowPrint === false ? undefined : "highResolution",
        copying: Boolean(options.allowCopy),
        modifying: Boolean(options.allowModify),
        annotating: Boolean(options.allowModify),
        fillingForms: Boolean(options.allowModify),
      },
    });
    const bytes = await doc.save({ useObjectStreams: false });
    outputs.push(fileFromBytes(withSuffix(files[i].name, "-protected"), bytes, PDF));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { Encryption: "AES-256", Files: String(outputs.length) } };
};

export const unlock: FileProcessor = async (files, { options, onProgress }) => {
  const password = String(options.password ?? "");
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const pdfjs = await import("pdfjs-dist");
    let src;
    try {
      src = await pdfjs.getDocument({ data: new Uint8Array(await files[i].arrayBuffer()), password }).promise;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      throw new ProcessorError(/password/i.test(msg) ? "Wrong password" : `Could not open ${files[i].name}`, /password/i.test(msg) ? "Check the password and try again." : undefined);
    }
    // Re-render through pdf.js into a clean, unencrypted document (keeps text layer via saveDocument when available).
    const data = await src.saveDocument();
    await closePdf(src);
    const doc = await PDFDocument.load(data, { ignoreEncryption: true });
    outputs.push(await save(doc, withSuffix(files[i].name, "-unlocked")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs };
};

/* ---------------- Signature / stamp image ---------------- */

export const sign: FileProcessor = async (files, { options, onProgress }) => {
  const pdfs = files.filter((f) => f.type === PDF || f.name.toLowerCase().endsWith(".pdf"));
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!pdfs.length) throw new ProcessorError("Add the PDF to sign");
  if (images.length !== 1) throw new ProcessorError("Add exactly one signature image (PNG with transparent background works best)");
  const imgFile = images[0];
  let imgBytes = await imgFile.arrayBuffer();
  let isPng = imgFile.type === "image/png";
  if (!isPng && imgFile.type !== "image/jpeg") {
    const { canvas } = await blobToCanvas(imgFile);
    imgBytes = await (await canvasToBlob(canvas, "image/png")).arrayBuffer();
    isPng = true;
  }
  const widthPct = Number(options.width ?? 25);
  const margin = Number(options.margin ?? 36);
  const position = String(options.position ?? "bottom-right");
  const pageSel = String(options.page ?? "last");
  const outputs: ProcessorFile[] = [];
  for (let i = 0; i < pdfs.length; i++) {
    const doc = await load(pdfs[i], pdfs[i].name);
    const img = isPng ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
    const pages = doc.getPages();
    const targets = pageSel === "all" ? pages.map((_, k) => k) : pageSel === "first" ? [0] : pageSel === "last" ? [pages.length - 1] : [Math.min(pages.length, Math.max(1, Number(pageSel) || pages.length)) - 1];
    for (const k of targets) {
      const page = pages[k];
      const { width, height } = page.getSize();
      const w = (width * widthPct) / 100;
      const h = (img.height / img.width) * w;
      const [v, hz] = position === "center" ? ["center", "center"] : position.split("-");
      const x = hz === "left" ? margin : hz === "right" ? width - margin - w : (width - w) / 2;
      const y = v === "top" ? height - margin - h : v === "bottom" ? margin : (height - h) / 2;
      page.drawImage(img, { x, y, width: w, height: h });
      const label = String(options.label ?? "");
      if (label.trim()) page.drawText(label.trim(), { x, y: y - 12, size: 9 });
    }
    outputs.push(await save(doc, withSuffix(pdfs[i].name, "-signed")));
    onProgress?.((i + 1) / pdfs.length);
  }
  return { files: outputs, stats: { Pages: pageSel, Files: String(outputs.length) } };
};

/* ---------------- Forms ---------------- */

export interface FormFieldInfo { name: string; type: "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "other"; value: string; options?: string[]; readOnly: boolean }

export async function readFormFields(file: Blob): Promise<FormFieldInfo[]> {
  const doc = await load(file);
  const form = doc.getForm();
  return form.getFields().map((f) => {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFTextField) return { name, type: "text", value: f.getText() ?? "", readOnly };
    if (f instanceof PDFCheckBox) return { name, type: "checkbox", value: f.isChecked() ? "true" : "false", readOnly };
    if (f instanceof PDFRadioGroup) return { name, type: "radio", value: f.getSelected() ?? "", options: f.getOptions(), readOnly };
    if (f instanceof PDFDropdown) return { name, type: "dropdown", value: f.getSelected()[0] ?? "", options: f.getOptions(), readOnly };
    if (f instanceof PDFOptionList) return { name, type: "optionlist", value: f.getSelected().join(", "), options: f.getOptions(), readOnly };
    return { name, type: "other", value: "", readOnly };
  });
}

export async function fillForm(file: Blob, values: Record<string, string>, flatten: boolean, name: string): Promise<ProcessorFile> {
  const doc = await load(file, name);
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const v = values[f.getName()];
    if (v === undefined) continue;
    try {
      if (f instanceof PDFTextField) f.setText(v);
      else if (f instanceof PDFCheckBox) { if (v === "true") f.check(); else f.uncheck(); }
      else if (f instanceof PDFRadioGroup) { if (v) f.select(v); }
      else if (f instanceof PDFDropdown) { if (v) f.select(v); }
      else if (f instanceof PDFOptionList) { f.select(v.split(",").map((s) => s.trim()).filter(Boolean)); }
    } catch {
      /* skip values the field rejects */
    }
  }
  if (flatten) form.flatten();
  return save(doc, withSuffix(name, flatten ? "-filled-flat" : "-filled"));
}

export const flatten: FileProcessor = async (files, { onProgress }) => {
  const outputs: ProcessorFile[] = [];
  let fields = 0;
  for (let i = 0; i < files.length; i++) {
    const doc = await load(files[i], files[i].name);
    const form = doc.getForm();
    fields += form.getFields().length;
    try { form.flatten(); } catch { /* no appearance streams: still save */ }
    outputs.push(await save(doc, withSuffix(files[i].name, "-flat")));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { "Fields flattened": String(fields) } };
};

export const formFields: FileProcessor = async (files) => {
  const results = [];
  for (const f of files) results.push({ file: f.name, fields: await readFormFields(f) });
  const out = jsonOutput(results.length === 1 ? results[0] : results);
  out.stats = { Fields: String(results.reduce((a, r) => a + r.fields.length, 0)) };
  return out;
};

/* ---------------- Redaction (true: pages are re-rendered with content removed) ---------------- */

export interface RedactBox { page: number; x: number; y: number; w: number; h: number } // PDF points, origin bottom-left

export async function findTermBoxes(file: Blob, terms: string[], onProgress?: (f: number) => void): Promise<RedactBox[]> {
  const doc = await openPdf(file);
  const boxes: RedactBox[] = [];
  const needles = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const lower = item.str.toLowerCase();
      for (const n of needles) {
        let idx = lower.indexOf(n);
        while (idx >= 0) {
          const fraction = idx / item.str.length;
          const frac2 = (idx + n.length) / item.str.length;
          const x = item.transform[4] + item.width * fraction;
          const w = item.width * (frac2 - fraction);
          const h = Math.max(item.height, Math.abs(item.transform[3]) || 10);
          boxes.push({ page: p, x: x - 1, y: item.transform[5] - h * 0.25, w: w + 2, h: h * 1.3 });
          idx = lower.indexOf(n, idx + 1);
        }
      }
    }
    page.cleanup();
    onProgress?.(p / doc.numPages);
  }
  await closePdf(doc);
  return boxes;
}

/** Rasterise every page that has boxes, painting black rectangles, and rebuild the PDF. Pages without boxes are copied intact. */
export async function applyRedaction(file: File, boxes: RedactBox[], onProgress?: (f: number, l?: string) => void, signal?: AbortSignal): Promise<ProcessorOutput> {
  if (!boxes.length) throw new ProcessorError("Nothing to redact", "Add search terms or draw at least one box.");
  const byPage = new Map<number, RedactBox[]>();
  for (const b of boxes) byPage.set(b.page, [...(byPage.get(b.page) ?? []), b]);
  const src = await openPdf(file);
  const original = await load(file, file.name);
  const out = await PDFDocument.create();
  const scale = 2;
  for (let p = 1; p <= src.numPages; p++) {
    throwIfAborted(signal);
    const list = byPage.get(p);
    if (!list) {
      const [copied] = await out.copyPages(original, [p - 1]);
      out.addPage(copied);
    } else {
      const page = await src.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPage(src, p, scale);
      const ctx = ctx2d(canvas);
      ctx.fillStyle = "#000";
      for (const b of list) ctx.fillRect(b.x * scale, (vp.height - b.y - b.h) * scale, b.w * scale, b.h * scale);
      const jpg = await canvasToBlob(canvas, "image/jpeg", 0.85);
      const img = await out.embedJpg(await jpg.arrayBuffer());
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    }
    onProgress?.(p / src.numPages, `Page ${p}/${src.numPages}`);
  }
  await closePdf(src);
  const fileOut = await save(out, withSuffix(file.name, "-redacted"));
  return { files: [fileOut], stats: { "Redacted areas": String(boxes.length), "Pages rebuilt": String(byPage.size), Output: formatBytes(fileOut.bytes) }, warnings: ["Redacted pages were converted to images so the hidden text cannot be recovered. Text on those pages is no longer selectable."] };
}

export const redactText: FileProcessor = async (files, { options, onProgress, signal }) => {
  const terms = String(options.terms ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!terms.length) throw new ProcessorError("Enter at least one word or phrase to redact");
  const outputs: ProcessorFile[] = [];
  let total = 0;
  const warnings = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const boxes = await findTermBoxes(files[i], terms, (f) => onProgress?.((i + f * 0.3) / files.length, "Searching"));
    if (!boxes.length) { warnings.add(`${files[i].name}: no matches found (scanned PDFs need OCR first).`); continue; }
    const r = await applyRedaction(files[i], boxes, (f, l) => onProgress?.((i + 0.3 + f * 0.7) / files.length, l), signal);
    total += boxes.length;
    outputs.push(...r.files);
    r.warnings?.forEach((w) => warnings.add(w));
  }
  if (!outputs.length) throw new ProcessorError("No matches found in any file", "Check spelling, or run OCR first for scanned documents.");
  return { files: outputs, stats: { Matches: String(total) }, warnings: [...warnings] };
};

/* ---------------- Page organiser (apply) ---------------- */

export interface PageOp { index: number; rotation: number }

export async function applyPageOps(file: File, ops: PageOp[]): Promise<ProcessorFile> {
  if (!ops.length) throw new ProcessorError("Keep at least one page");
  const src = await load(file, file.name);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, ops.map((o) => o.index));
  copied.forEach((p, i) => {
    if (ops[i].rotation) p.setRotation(degrees((p.getRotation().angle + ops[i].rotation) % 360));
    out.addPage(p);
  });
  return save(out, withSuffix(file.name, "-organised"));
}

/* ---------------- Smart split: by bookmarks, marker text or date change ---------------- */

export const splitSmart: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "bookmarks");
  const marker = String(options.marker ?? "").trim().toLowerCase();
  const outputs: ProcessorFile[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const doc = await openPdf(file);
    const starts: { page: number; label: string }[] = [];
    if (mode === "bookmarks") {
      const outline = await doc.getOutline();
      if (!outline?.length) { await closePdf(doc); throw new ProcessorError(`${file.name} has no bookmarks`, "Try splitting by marker text or date instead."); }
      for (const item of outline) {
        try {
          const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
          if (dest && dest[0]) starts.push({ page: (await doc.getPageIndex(dest[0])) + 1, label: item.title });
        } catch { /* skip unresolved */ }
      }
    } else {
      if (mode === "marker" && !marker) throw new ProcessorError("Enter the marker text that starts each document", "For example: Statement Date, Account Number, Invoice");
      let lastValue = "";
      for (let p = 1; p <= doc.numPages; p++) {
        throwIfAborted(signal);
        const text = await pageText(doc, p);
        const lower = text.toLowerCase();
        if (mode === "marker") {
          if (lower.includes(marker)) {
            const after = text.slice(lower.indexOf(marker) + marker.length, lower.indexOf(marker) + marker.length + 40).replace(/\s+/g, " ").trim();
            starts.push({ page: p, label: after.split(" ").slice(0, 3).join(" ") || `part-${starts.length + 1}` });
          }
        } else {
          // date mode: a new document starts when the first date on the page changes
          const m = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})\b/);
          const d = m ? parseDate(m[1], "mdy") : null;
          const key = d ? d.toISOString().slice(0, 10) : "";
          if (key && key !== lastValue) { starts.push({ page: p, label: key }); lastValue = key; }
        }
        onProgress?.((fi + (p / doc.numPages) * 0.5) / files.length, `Scanning page ${p}`);
      }
      if (!starts.length) { await closePdf(doc); throw new ProcessorError(`No ${mode === "marker" ? "marker text" : "dates"} found in ${file.name}`, "Scanned PDFs need OCR first."); }
    }
    const total = doc.numPages;
    await closePdf(doc);
    const uniq = [...new Map(starts.map((s) => [s.page, s])).values()].sort((a, b) => a.page - b.page);
    if (uniq[0].page !== 1) uniq.unshift({ page: 1, label: "front" });
    const src = await load(file, file.name);
    for (let k = 0; k < uniq.length; k++) {
      throwIfAborted(signal);
      const from = uniq[k].page;
      const to = k + 1 < uniq.length ? uniq[k + 1].page - 1 : total;
      const part = await PDFDocument.create();
      (await part.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))).forEach((pg) => part.addPage(pg));
      const label = uniq[k].label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || `part-${k + 1}`;
      outputs.push(await save(part, `${baseName(file.name)}-${String(k + 1).padStart(2, "0")}-${label}.pdf`));
      onProgress?.((fi + 0.5 + ((k + 1) / uniq.length) * 0.5) / files.length);
    }
  }
  return { files: await maybeZip(outputs, `${baseName(files[0].name)}-split.zip`), stats: { Parts: String(outputs.length) } };
};
