import { ProcessorError } from "@/types/processor";

export async function loadImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProcessorError("Could not decode image", "The file may be corrupt or an unsupported format"));
    };
    img.src = url;
  });
}

export function dims(img: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return "naturalWidth" in img ? { width: img.naturalWidth, height: img.naturalHeight } : { width: img.width, height: img.height };
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function ctx2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new ProcessorError("Canvas is not available in this browser");
  return ctx;
}

export async function canvasToBlob(c: HTMLCanvasElement | OffscreenCanvas, type = "image/png", quality?: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new ProcessorError("Could not encode image"))), type, quality),
  );
}

export function extForMime(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "img";
}

/** Draw a blob onto a fresh canvas; returns canvas + dimensions. */
export async function blobToCanvas(blob: Blob) {
  const img = await loadImage(blob);
  const { width, height } = dims(img);
  const c = makeCanvas(width, height);
  ctx2d(c).drawImage(img, 0, 0);
  if ("close" in img) img.close();
  return { canvas: c, width, height };
}

export function hexToRgba(hex: string, alpha = 1): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
