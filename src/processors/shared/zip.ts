import JSZip from "jszip";
import type { ProcessorFile } from "@/types/processor";

export async function zipFiles(files: ProcessorFile[], name = "output.zip", level = 6): Promise<ProcessorFile> {
  const zip = new JSZip();
  const seen = new Map<string, number>();
  for (const f of files) {
    let n = f.name;
    const count = seen.get(n) ?? 0;
    if (count > 0) {
      const i = n.lastIndexOf(".");
      n = i > 0 ? `${n.slice(0, i)} (${count})${n.slice(i)}` : `${n} (${count})`;
    }
    seen.set(f.name, count + 1);
    zip.file(n, f.blob);
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: level === 0 ? "STORE" : "DEFLATE",
    compressionOptions: { level },
  });
  return { name, blob, bytes: blob.size, mime: "application/zip" };
}

/** If there is more than one output, bundle into a zip; otherwise return as-is. */
export async function maybeZip(files: ProcessorFile[], zipName: string): Promise<ProcessorFile[]> {
  if (files.length <= 1) return files;
  return [await zipFiles(files, zipName)];
}
