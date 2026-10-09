import type { ProcessorFile, ProcessorOutput } from "@/types/processor";
import { formatBytes, percentSaved } from "@/lib/utils";

export function fileFromBytes(name: string, bytes: Uint8Array | ArrayBuffer, mime: string): ProcessorFile {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return { name, blob, bytes: blob.size, mime };
}

export function fileFromText(name: string, text: string, mime = "text/plain"): ProcessorFile {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  return { name, blob, bytes: blob.size, mime };
}

export function fileFromBlob(name: string, blob: Blob): ProcessorFile {
  return { name, blob, bytes: blob.size, mime: blob.type };
}

export function sizeStats(original: number, output: number): Record<string, string> {
  return { Original: formatBytes(original), Output: formatBytes(output), Saved: percentSaved(original, output) };
}

export function textOutput(text: string, data?: unknown, stats?: Record<string, string>): ProcessorOutput {
  return { files: [], text, data, stats };
}

export function jsonOutput(data: unknown, stats?: Record<string, string>): ProcessorOutput {
  return { files: [], text: JSON.stringify(data, null, 2), data, stats };
}
