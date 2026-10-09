import type { PDFDocumentProxy } from "pdfjs-dist";
import { ProcessorError } from "@/types/processor";

let lib: typeof import("pdfjs-dist") | null = null;

export async function getPdfjs() {
  if (lib) return lib;
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  lib = mod;
  return mod;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await pdfjs.getDocument({ data }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new ProcessorError("This PDF is password protected", "Remove the password first");
    throw new ProcessorError("Could not read this PDF", msg);
  }
}

/** Release worker memory for a document. pdf.js v6 removed PDFDocumentProxy.destroy(). */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  try {
    await doc.loadingTask.destroy();
  } catch {
    /* already destroyed */
  }
}

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  // pdf.js accepts an OffscreenCanvas context at runtime; its types only name the DOM one.
  // intent "print": display intent paces work with requestAnimationFrame, which browsers
  // pause in background tabs, so long batch conversions would stall the moment a user
  // switched tabs. Print intent renders synchronously to completion.
  await page.render({ canvasContext: ctx, viewport, canvas: canvas as HTMLCanvasElement, intent: "print" }).promise;
  page.cleanup();
  return canvas;
}

export async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  let out = "";
  let lastY: number | null = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
    else if (out && !out.endsWith("\n") && !out.endsWith(" ") && item.str && !item.str.startsWith(" ")) out += " ";
    out += item.str;
    lastY = y;
  }
  page.cleanup();
  return out.trim();
}

/** Text items grouped into visual lines with x positions, for table detection. */
export async function pageLines(doc: PDFDocumentProxy, pageNumber: number): Promise<{ x: number; str: string }[][]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    const row = rows.get(y) ?? [];
    row.push({ x: item.transform[4], str: item.str });
    rows.set(y, row);
  }
  page.cleanup();
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x));
}
