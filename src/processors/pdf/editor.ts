import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import type { ProcessorOutput } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { fileFromBytes } from "../shared/output";
import { safeText } from "../shared/pdfwriter";

/**
 * Annotations drawn in the PDF editor, in PDF points with the origin at the
 * bottom-left of the page. They are burned into the page content so every
 * viewer shows them.
 */
export type EditItem =
  | { kind: "text"; page: number; x: number; y: number; text: string; size: number; color: string; bold?: boolean }
  | { kind: "rect"; page: number; x: number; y: number; w: number; h: number; color: string; fill: boolean; opacity: number; stroke: number }
  | { kind: "highlight"; page: number; x: number; y: number; w: number; h: number; color: string }
  | { kind: "whiteout"; page: number; x: number; y: number; w: number; h: number }
  | { kind: "line"; page: number; points: { x: number; y: number }[]; color: string; width: number }
  | { kind: "image"; page: number; x: number; y: number; w: number; h: number; bytes: Uint8Array; mime: string }
  | { kind: "check"; page: number; x: number; y: number; size: number; color: string };

const toRgb = (hex: string) => { const h = hex.replace("#", ""); const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h; return rgb(parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255); };

export async function applyEdits(file: File, items: EditItem[], onProgress?: (f: number, l?: string) => void): Promise<ProcessorOutput> {
  if (!items.length) throw new ProcessorError("Nothing to apply yet", "Add text, boxes, highlights, drawings or an image first.");
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }); }
  catch { throw new ProcessorError("Could not open this PDF", "It may be damaged or password protected."); }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  const pages = doc.getPages();
  const imageCache = new Map<Uint8Array, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const page = pages[it.page - 1];
    if (!page) continue;
    const rot = page.getRotation().angle;
    switch (it.kind) {
      case "text": {
        const f = it.bold ? bold : font;
        const lines = it.text.split(/\r?\n/);
        lines.forEach((line, k) => page.drawText(safeText(line), { x: it.x, y: it.y - k * it.size * 1.25, size: it.size, font: f, color: toRgb(it.color), rotate: degrees(rot) }));
        break;
      }
      case "rect":
        page.drawRectangle({ x: it.x, y: it.y, width: it.w, height: it.h, borderColor: toRgb(it.color), borderWidth: it.stroke, color: it.fill ? toRgb(it.color) : undefined, opacity: it.fill ? it.opacity : undefined, borderOpacity: it.opacity });
        break;
      case "highlight":
        page.drawRectangle({ x: it.x, y: it.y, width: it.w, height: it.h, color: toRgb(it.color), opacity: 0.35 });
        break;
      case "whiteout":
        page.drawRectangle({ x: it.x, y: it.y, width: it.w, height: it.h, color: rgb(1, 1, 1) });
        break;
      case "line":
        for (let k = 1; k < it.points.length; k++) page.drawLine({ start: it.points[k - 1], end: it.points[k], thickness: it.width, color: toRgb(it.color), lineCap: 1 });
        break;
      case "check":
        page.drawText("4", { x: it.x, y: it.y, size: it.size, font: dingbats, color: toRgb(it.color) }); // "4" is the check mark in ZapfDingbats
        break;
      case "image": {
        let img = imageCache.get(it.bytes);
        if (!img) { img = it.mime === "image/png" ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes); imageCache.set(it.bytes, img); }
        page.drawImage(img, { x: it.x, y: it.y, width: it.w, height: it.h });
        break;
      }
    }
    onProgress?.((i + 1) / items.length, "Applying");
  }
  const bytes = await doc.save();
  return { files: [fileFromBytes(`${baseName(file.name)}-edited.pdf`, bytes, "application/pdf")], stats: { Edits: String(items.length), Output: formatBytes(bytes.length) } };
}
