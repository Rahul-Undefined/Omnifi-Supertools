import { safeFileName } from "./utils";

/** Magic-number detection for common types. Never trust the extension alone. */
export function detectMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const starts = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts([0x42, 0x4d])) return "image/bmp";
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (starts([0x1f, 0x8b])) return "application/gzip";
  if (starts([0x52, 0x61, 0x72, 0x21])) return "application/vnd.rar";
  if (starts([0x37, 0x7a, 0xbc, 0xaf])) return "application/x-7z-compressed";
  if (starts([0x00, 0x00, 0x00]) && (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return "video/mp4";
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (starts([0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (starts([0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x41, 0x56, 0x45], 8)) return "audio/wav";
  if (starts([0x3c, 0x3f, 0x78, 0x6d, 0x6c])) return "application/xml";
  if (starts([0xd0, 0xcf, 0x11, 0xe0])) return "application/x-ole-storage"; // legacy office
  return null;
}

export async function sniffFile(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return detectMime(head);
}

const extMime: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  csv: "text/csv",
  txt: "text/plain",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  md: "text/markdown",
  html: "text/html",
};

export function mimeForExt(ext: string): string {
  return extMime[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Validate a file against a tool's accepted input list.
 * Accepts entries like "pdf", "image/*", "image/png", ".csv".
 */
export async function validateFile(
  file: File,
  accepted: string[],
  maxBytes: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (file.size === 0) return { ok: false, reason: "File is empty" };
  if (file.size > maxBytes) return { ok: false, reason: `File is larger than the limit` };
  if (accepted.length === 0 || accepted.includes("*")) return { ok: true };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const declared = file.type || mimeForExt(ext);
  const sniffed = await sniffFile(file);

  const matches = accepted.some((a) => {
    const rule = a.toLowerCase().replace(/^\./, "");
    if (rule.endsWith("/*")) {
      const prefix = rule.slice(0, -1);
      return declared.startsWith(prefix) || (sniffed?.startsWith(prefix) ?? false);
    }
    if (rule.includes("/")) return declared === rule || sniffed === rule;
    return ext === rule || mimeForExt(rule) === declared || mimeForExt(rule) === sniffed;
  });
  if (!matches) return { ok: false, reason: `Unsupported file type (.${ext || "unknown"})` };

  // Guard against disguised binaries for strongly-typed formats.
  if (sniffed && declared !== "application/octet-stream" && sniffed !== declared) {
    const family = (m: string) => m.split("/")[0];
    const textish = ["text", "application/json", "application/xml", "image/svg+xml"];
    const declaredTextish = textish.some((t) => declared.startsWith(t));
    if (!declaredTextish && family(sniffed) !== family(declared) && sniffed !== "application/zip") {
      return { ok: false, reason: "File contents do not match its extension" };
    }
  }
  return { ok: true };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function readText(file: File): Promise<string> {
  return file.text();
}

export function textBlob(text: string, mime = "text/plain"): Blob {
  return new Blob([text], { type: `${mime};charset=utf-8` });
}
