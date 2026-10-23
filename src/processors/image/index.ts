import type { FileProcessor, ProcessorFile, TextProcessor } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { blobToCanvas, canvasToBlob, ctx2d, extForMime, hexToRgba, loadImage, dims, makeCanvas } from "../shared/canvas";
import { sizeStats, jsonOutput, fileFromText } from "../shared/output";
import { zipFiles } from "../shared/zip";
import { readExif } from "./exif";

type Canvas = HTMLCanvasElement | OffscreenCanvas;

function outMime(file: File, options: Record<string, unknown>, fallback = "image/jpeg"): string {
  if (options.keepFormat && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file.type;
  const f = String(options.format ?? "");
  return f.startsWith("image/") ? f : file.type === "image/png" ? "image/png" : fallback;
}

async function emit(canvas: Canvas, file: File, mime: string, quality: number | undefined, suffix: string): Promise<ProcessorFile> {
  const blob = await canvasToBlob(canvas, mime, quality);
  return { name: `${baseName(file.name)}${suffix}.${extForMime(mime)}`, blob, bytes: blob.size, mime };
}

/** Generic per-file canvas pipeline. */
async function perFile(
  files: File[],
  onProgress: ((f: number, l?: string) => void) | undefined,
  signal: AbortSignal | undefined,
  fn: (file: File, index: number) => Promise<ProcessorFile>,
) {
  const out: ProcessorFile[] = [];
  let original = 0;
  let output = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const r = await fn(files[i], i);
    original += files[i].size;
    output += r.bytes;
    out.push(r);
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return { files: out, stats: sizeStats(original, output) };
}

export const compress: FileProcessor = async (files, { options, onProgress, signal }) => {
  const quality = Number(options.quality ?? 0.75);
  const maxDim = Number(options.maxDimension ?? 0);
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas, width, height } = await blobToCanvas(file);
    let target = canvas;
    if (maxDim > 0 && Math.max(width, height) > maxDim) {
      const s = maxDim / Math.max(width, height);
      target = makeCanvas(Math.round(width * s), Math.round(height * s));
      ctx2d(target).drawImage(canvas as CanvasImageSource, 0, 0, target.width, target.height);
    }
    let mime = outMime(file, options);
    const r = await emit(target, file, mime, quality, "-compressed");
    if (r.bytes >= file.size && mime === "image/png") {
      // PNG ignores quality; try WebP which usually wins for photos.
      mime = "image/webp";
      const alt = await emit(target, file, mime, quality, "-compressed");
      if (alt.bytes < file.size) return alt;
    }
    return r.bytes < file.size ? r : { name: r.name, blob: file, bytes: file.size, mime: file.type };
  });
};

export const resize: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "width");
  return perFile(files, onProgress, signal, async (file) => {
    const img = await loadImage(file);
    const { width, height } = dims(img);
    let w = width;
    let h = height;
    if (mode === "width") { w = Number(options.width) || width; h = Math.round(height * (w / width)); }
    else if (mode === "height") { h = Number(options.height) || height; w = Math.round(width * (h / height)); }
    else if (mode === "percent") { const p = (Number(options.percent) || 100) / 100; w = Math.round(width * p); h = Math.round(height * p); }
    else { w = Number(options.width) || width; h = Number(options.height) || height; }
    w = Math.max(1, Math.min(w, 16384));
    h = Math.max(1, Math.min(h, 16384));
    const c = makeCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    if ("close" in img) img.close();
    return emit(c, file, outMime(file, options), 0.92, `-${w}x${h}`);
  });
};

export const convert: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mime = String(options.format ?? "image/jpeg");
  const quality = Number(options.quality ?? 0.9);
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas } = await blobToCanvas(file);
    if (mime === "image/jpeg") {
      // JPEG has no alpha: flatten onto white.
      const flat = makeCanvas(canvas.width, canvas.height);
      const ctx = ctx2d(flat);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas as CanvasImageSource, 0, 0);
      return emit(flat, file, mime, quality, "");
    }
    return emit(canvas, file, mime, quality, "");
  });
};

export const crop: FileProcessor = async (files, { options, onProgress, signal }) => {
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas, width, height } = await blobToCanvas(file);
    let x = 0, y = 0, w = width, h = height;
    if (String(options.mode ?? "ratio") === "ratio") {
      const [rw, rh] = String(options.ratio ?? "1:1").split(":").map(Number);
      const target = rw / rh;
      if (width / height > target) { w = Math.round(height * target); x = Math.round((width - w) / 2); }
      else { h = Math.round(width / target); y = Math.round((height - h) / 2); }
    } else {
      x = Math.max(0, Number(options.x) || 0);
      y = Math.max(0, Number(options.y) || 0);
      w = Math.min(width - x, Number(options.width) || width);
      h = Math.min(height - y, Number(options.height) || height);
      if (w <= 0 || h <= 0) throw new ProcessorError("Crop rectangle is outside the image", `Image is ${width}×${height}`);
    }
    const c = makeCanvas(w, h);
    ctx2d(c).drawImage(canvas as CanvasImageSource, x, y, w, h, 0, 0, w, h);
    return emit(c, file, outMime(file, { keepFormat: true }), 0.92, "-cropped");
  });
};

export const rotate: FileProcessor = async (files, { options, onProgress, signal }) => {
  const angle = Number(options.angle ?? 90);
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas, width, height } = await blobToCanvas(file);
    const swap = angle === 90 || angle === 270;
    const c = makeCanvas(swap ? height : width, swap ? width : height);
    const ctx = ctx2d(c);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(canvas as CanvasImageSource, -width / 2, -height / 2);
    return emit(c, file, outMime(file, { keepFormat: true }), 0.92, "-rotated");
  });
};

export const flip: FileProcessor = async (files, { options, onProgress, signal }) => {
  const horizontal = String(options.direction ?? "horizontal") === "horizontal";
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas, width, height } = await blobToCanvas(file);
    const c = makeCanvas(width, height);
    const ctx = ctx2d(c);
    ctx.translate(horizontal ? width : 0, horizontal ? 0 : height);
    ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    ctx.drawImage(canvas as CanvasImageSource, 0, 0);
    return emit(c, file, outMime(file, { keepFormat: true }), 0.92, "-flipped");
  });
};

export const stripMetadata: FileProcessor = async (files, { onProgress, signal }) => {
  // Re-encoding pixels through a canvas discards EXIF/XMP/ICC chunks.
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas } = await blobToCanvas(file);
    return emit(canvas, file, outMime(file, { keepFormat: true }), 0.92, "-clean");
  });
};

export const metadata: FileProcessor = async (files) => {
  const results: Record<string, unknown>[] = [];
  for (const file of files) {
    const img = await loadImage(file);
    const { width, height } = dims(img);
    if ("close" in img) img.close();
    const exif = file.type === "image/jpeg" ? await readExif(file) : {};
    results.push({ file: file.name, type: file.type, size: formatBytes(file.size), width, height, megapixels: +((width * height) / 1e6).toFixed(2), lastModified: new Date(file.lastModified).toISOString(), exif });
  }
  return jsonOutput(results.length === 1 ? results[0] : results);
};

export const watermark: FileProcessor = async (files, { options, onProgress, signal }) => {
  const text = String(options.text ?? "Omnifi");
  const opacity = Number(options.opacity ?? 0.35);
  const sizePct = Number(options.size ?? 6);
  const color = String(options.color ?? "#4F5BD5");
  const position = String(options.position ?? "center");
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas, width, height } = await blobToCanvas(file);
    const ctx = ctx2d(canvas);
    const fontSize = Math.max(10, (width * sizePct) / 100);
    ctx.font = `600 ${fontSize}px Geist, "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.textBaseline = "middle";
    if (position === "tile") {
      ctx.textAlign = "center";
      const step = fontSize * 4;
      ctx.save();
      ctx.rotate(-Math.PI / 6);
      for (let y = -height; y < height * 2; y += step) for (let x = -width; x < width * 2; x += step * 1.6) ctx.fillText(text, x, y);
      ctx.restore();
    } else if (position === "bottom-right") {
      ctx.textAlign = "right";
      ctx.fillText(text, width - fontSize * 0.6, height - fontSize);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(text, width / 2, height / 2);
    }
    return emit(canvas, file, outMime(file, { keepFormat: true }), 0.92, "-watermarked");
  });
};

export const blur: FileProcessor = async (files, { options, onProgress, signal }) => {
  const radius = Number(options.radius ?? 8);
  return perFile(files, onProgress, signal, async (file) => {
    const img = await loadImage(file);
    const { width, height } = dims(img);
    const c = makeCanvas(width, height);
    const ctx = ctx2d(c);
    const supportsFilter = typeof (ctx as { filter?: unknown }).filter === "string";
    if (supportsFilter) {
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(img, 0, 0);
    } else {
      // Fallback: downscale/upscale for browsers without canvas filters.
      const small = makeCanvas(Math.max(1, width / radius), Math.max(1, height / radius));
      ctx2d(small).drawImage(img, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small as CanvasImageSource, 0, 0, width, height);
    }
    if ("close" in img) img.close();
    return emit(c, file, outMime(file, { keepFormat: true }), 0.92, "-blurred");
  });
};

export const pixelate: FileProcessor = async (files, { options, onProgress, signal }) => {
  const block = Math.max(2, Number(options.block ?? 12));
  return perFile(files, onProgress, signal, async (file) => {
    const img = await loadImage(file);
    const { width, height } = dims(img);
    const small = makeCanvas(Math.max(1, Math.round(width / block)), Math.max(1, Math.round(height / block)));
    ctx2d(small).drawImage(img, 0, 0, small.width, small.height);
    const c = makeCanvas(width, height);
    const ctx = ctx2d(c);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small as CanvasImageSource, 0, 0, width, height);
    if ("close" in img) img.close();
    return emit(c, file, outMime(file, { keepFormat: true }), 0.92, "-pixelated");
  });
};

export const qrGenerate: TextProcessor = async (input, { options }) => {
  const QRCode = await import("qrcode");
  const content = input.trim();
  if (!content) throw new ProcessorError("Enter the text or link to encode");
  const size = Math.min(2048, Math.max(64, Number(options.size ?? 512)));
  const ecl = String(options.ecl ?? "M") as "L" | "M" | "Q" | "H";
  const color = { dark: String(options.dark ?? "#0A0F3D"), light: String(options.light ?? "#FFFFFF") };
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, content, { width: size, errorCorrectionLevel: ecl, margin: 2, color });
  const png = await canvasToBlob(canvas, "image/png");
  const svg = await QRCode.toString(content, { type: "svg", errorCorrectionLevel: ecl, margin: 2, color });
  return {
    files: [
      { name: "qr-code.png", blob: png, bytes: png.size, mime: "image/png" },
      fileFromText("qr-code.svg", svg, "image/svg+xml"),
    ],
    stats: { Size: `${size}px`, "Error correction": ecl },
  };
};

export const qrRead: FileProcessor = async (files) => {
  const jsQR = (await import("jsqr")).default;
  const results: { file: string; data: string | null }[] = [];
  for (const file of files) {
    const { canvas, width, height } = await blobToCanvas(file);
    const imageData = ctx2d(canvas).getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
    results.push({ file: file.name, data: code?.data ?? null });
  }
  const found = results.filter((r) => r.data);
  if (!found.length) throw new ProcessorError("No QR code found", "Make sure the code is sharp, well lit and not too small.");
  const text = results.map((r) => (files.length > 1 ? `${r.file}: ` : "") + (r.data ?? "(no code found)")).join("\n");
  return { files: [], text, data: results, stats: { Decoded: `${found.length}/${files.length}` } };
};

export const favicon: FileProcessor = async (files) => {
  const file = files[0];
  if (!file) throw new ProcessorError("Add an image");
  const img = await loadImage(file);
  const sizes = [16, 32, 48, 64, 128, 180, 192, 256, 512];
  const outputs: ProcessorFile[] = [];
  const pngs: { size: number; bytes: Uint8Array }[] = [];
  for (const s of sizes) {
    const c = makeCanvas(s, s);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, s, s);
    const blob = await canvasToBlob(c, "image/png");
    const name = s === 180 ? "apple-touch-icon.png" : `favicon-${s}x${s}.png`;
    outputs.push({ name, blob, bytes: blob.size, mime: "image/png" });
    if (s <= 48) pngs.push({ size: s, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  if ("close" in img) img.close();
  outputs.push(buildIco(pngs));
  outputs.push(fileFromText("site.webmanifest", JSON.stringify({ icons: [{ src: "/favicon-192x192.png", sizes: "192x192", type: "image/png" }, { src: "/favicon-512x512.png", sizes: "512x512", type: "image/png" }] }, null, 2), "application/manifest+json"));
  const zip = await zipFiles(outputs, `${baseName(file.name)}-favicons.zip`);
  return { files: [zip], stats: { Icons: String(outputs.length) } };
};

/** ICO container wrapping PNG-encoded images (supported by all modern browsers). */
function buildIco(pngs: { size: number; bytes: Uint8Array }[]): ProcessorFile {
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((a, p) => a + p.bytes.length, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0, true);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, pngs.length, true);
  let offset = header;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    buf[e] = p.size >= 256 ? 0 : p.size;
    buf[e + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, p.bytes.length, true);
    dv.setUint32(e + 12, offset, true);
    buf.set(p.bytes, offset);
    offset += p.bytes.length;
  });
  const blob = new Blob([buf], { type: "image/x-icon" });
  return { name: "favicon.ico", blob, bytes: blob.size, mime: "image/x-icon" };
}

export const palette: FileProcessor = async (files, { options }) => {
  const count = Math.min(16, Math.max(2, Number(options.count ?? 6)));
  const results: { file: string; colors: { hex: string; share: string }[] }[] = [];
  for (const file of files) {
    const img = await loadImage(file);
    const c = makeCanvas(64, 64);
    ctx2d(c).drawImage(img, 0, 0, 64, 64);
    if ("close" in img) img.close();
    const data = ctx2d(c).getImageData(0, 0, 64, 64).data;
    // Quantise to a 4-bit-per-channel histogram, then take the top buckets.
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
    const total = [...buckets.values()].reduce((a, b) => a + b.n, 0) || 1;
    const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
    const toHex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
    results.push({ file: file.name, colors: top.map((b) => ({ hex: `#${toHex(b.r / b.n)}${toHex(b.g / b.n)}${toHex(b.b / b.n)}`.toUpperCase(), share: `${((b.n / total) * 100).toFixed(1)}%` })) });
  }
  const single = results.length === 1 ? results[0] : results;
  return { ...jsonOutput(single), text: results.map((r) => r.colors.map((c) => `${c.hex}  ${c.share}`).join("\n")).join("\n\n") };
};
export { opacity, colorToTransparent, splitGrid } from "./extra";
