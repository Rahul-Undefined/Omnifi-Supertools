import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName } from "@/lib/utils";
import { blobToCanvas, canvasToBlob, ctx2d, makeCanvas } from "../shared/canvas";
import { zipFiles } from "../shared/zip";

/** Image utilities: opacity, colour-to-transparent / replace colour, split into a grid. */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new ProcessorError("Colour must be hex like #FFFFFF");
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};

async function eachImage(files: File[], onProgress: ((f: number, l?: string) => void) | undefined, signal: AbortSignal | undefined, fn: (file: File, canvas: HTMLCanvasElement | OffscreenCanvas, g: Ctx) => Promise<ProcessorFile | ProcessorFile[]>) {
  const out: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const { canvas } = await blobToCanvas(files[i]);
    const r = await fn(files[i], canvas, ctx2d(canvas));
    out.push(...(Array.isArray(r) ? r : [r]));
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return out;
}

export const opacity: FileProcessor = async (files, { options, onProgress, signal }) => {
  const alpha = Math.max(0, Math.min(100, Number(options.opacity ?? 50))) / 100;
  const outputs = await eachImage(files, onProgress, signal, async (file, canvas, g) => {
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * alpha);
    g.putImageData(img, 0, 0);
    const blob = await canvasToBlob(canvas, "image/png");
    return { name: `${baseName(file.name)}-opacity-${Math.round(alpha * 100)}.png`, blob, bytes: blob.size, mime: "image/png" };
  });
  return { files: outputs, stats: { Opacity: `${Math.round(alpha * 100)}%`, Images: String(outputs.length) } };
};

export const colorToTransparent: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "transparent");
  const tolerance = Math.max(0, Math.min(255, Number(options.tolerance ?? 30)));
  const auto = Boolean(options.autoColor);
  const target = auto ? null : hexToRgb(String(options.color ?? "#FFFFFF"));
  const replacement = mode === "replace" ? hexToRgb(String(options.replaceWith ?? "#000000")) : null;
  let changedTotal = 0;
  const outputs = await eachImage(files, onProgress, signal, async (file, canvas, g) => {
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const t = target ?? [d[0], d[1], d[2]]; // auto: top-left pixel colour
    let changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.sqrt((d[i] - t[0]) ** 2 + (d[i + 1] - t[1]) ** 2 + (d[i + 2] - t[2]) ** 2);
      if (dist <= tolerance) {
        changed++;
        if (replacement) { d[i] = replacement[0]; d[i + 1] = replacement[1]; d[i + 2] = replacement[2]; }
        else d[i + 3] = options.soft ? Math.round(d[i + 3] * (dist / Math.max(1, tolerance))) : 0;
      }
    }
    changedTotal += changed;
    g.putImageData(img, 0, 0);
    const blob = await canvasToBlob(canvas, "image/png");
    return { name: `${baseName(file.name)}-${mode === "replace" ? "recolored" : "transparent"}.png`, blob, bytes: blob.size, mime: "image/png" };
  });
  return { files: outputs, stats: { Images: String(outputs.length), "Pixels changed": changedTotal.toLocaleString() }, warnings: changedTotal === 0 ? ["No pixels matched. Increase the tolerance or pick the exact colour (tick 'use the top-left pixel colour' for backgrounds)."] : [] };
};

export const splitGrid: FileProcessor = async (files, { options, onProgress, signal }) => {
  const rows = Math.max(1, Math.min(20, Math.floor(Number(options.rows ?? 2))));
  const cols = Math.max(1, Math.min(20, Math.floor(Number(options.cols ?? 2))));
  const format = String(options.format ?? "image/png");
  const ext = format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";
  const outputs = await eachImage(files, onProgress, signal, async (file, canvas) => {
    const tw = Math.floor(canvas.width / cols), th = Math.floor(canvas.height / rows);
    if (tw < 1 || th < 1) throw new ProcessorError("Too many tiles for this image size");
    const tiles: ProcessorFile[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = makeCanvas(tw, th);
      ctx2d(t).drawImage(canvas as CanvasImageSource, c * tw, r * th, tw, th, 0, 0, tw, th);
      const blob = await canvasToBlob(t, format, format === "image/png" ? undefined : 0.92);
      tiles.push({ name: `${baseName(file.name)}-r${r + 1}c${c + 1}.${ext}`, blob, bytes: blob.size, mime: format });
    }
    return tiles;
  });
  const zip = await zipFiles(outputs, files.length === 1 ? `${baseName(files[0].name)}-tiles.zip` : "image-tiles.zip", 0);
  return { files: [zip], stats: { Tiles: String(outputs.length), Grid: `${rows} × ${cols}` } };
};
