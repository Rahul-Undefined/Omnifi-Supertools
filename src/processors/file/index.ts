import JSZip from "jszip";
import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, formatBytes } from "@/lib/utils";
import { detectMime, mimeForExt } from "@/lib/files";
import { zipFiles } from "../shared/zip";
import { allHashes, digest, hex } from "../shared/hash";
import { fileFromText, jsonOutput, textOutput } from "../shared/output";

export const zip: FileProcessor = async (files, { options, onProgress }) => {
  if (!files.length) throw new ProcessorError("Add at least one file");
  const level = Number(options.level ?? 6);
  const out = await zipFiles(files.map((f) => ({ name: f.name, blob: f, bytes: f.size })), files.length === 1 ? `${baseName(files[0].name)}.zip` : "archive.zip", level);
  onProgress?.(1);
  const original = files.reduce((a, f) => a + f.size, 0);
  return { files: [out], stats: { Files: String(files.length), Original: formatBytes(original), Output: formatBytes(out.bytes) } };
};

export const unzip: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs: ProcessorFile[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < files.length; i++) {
    let z: JSZip;
    try {
      z = await JSZip.loadAsync(await files[i].arrayBuffer());
    } catch {
      throw new ProcessorError(`${files[i].name} is not a valid ZIP`, "Encrypted archives are not supported.");
    }
    const entries = Object.values(z.files).filter((e) => !e.dir);
    if (!entries.length) throw new ProcessorError(`${files[i].name} is empty`);
    for (const e of entries) {
      throwIfAborted(signal);
      // Path traversal guard: keep only the final segment, drop anything odd.
      const name = e.name.split(/[\\/]/).pop() ?? "file";
      if (e.name.includes("..")) warnings.push(`Skipped suspicious entry "${e.name}"`);
      else {
        const blob = await e.async("blob");
        outputs.push({ name, blob, bytes: blob.size, mime: mimeForExt(name.split(".").pop() ?? "") });
      }
    }
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { Extracted: String(outputs.length) }, warnings: warnings.length ? warnings : undefined };
};

export const split: FileProcessor = async (files, { options, onProgress }) => {
  const file = files[0];
  if (!file) throw new ProcessorError("Add a file");
  const chunk = Math.max(1, Number(options.chunkMb ?? 25)) * 1024 * 1024;
  if (file.size <= chunk) throw new ProcessorError("File is smaller than the chunk size");
  const parts: ProcessorFile[] = [];
  const total = Math.ceil(file.size / chunk);
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * chunk, Math.min(file.size, (i + 1) * chunk));
    parts.push({ name: `${file.name}.part${String(i + 1).padStart(3, "0")}`, blob, bytes: blob.size, mime: "application/octet-stream" });
    onProgress?.((i + 1) / total);
  }
  return { files: [await zipFiles(parts, `${baseName(file.name)}-parts.zip`, 0)], stats: { Parts: String(total), "Chunk size": formatBytes(chunk) } };
};

export const merge: FileProcessor = async (files, { options }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two parts");
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const name = String(options.name ?? "").trim() || sorted[0].name.replace(/\.part\d+$/, "") || "merged.bin";
  const blob = new Blob(sorted, { type: mimeForExt(name.split(".").pop() ?? "") });
  return { files: [{ name, blob, bytes: blob.size, mime: blob.type }], stats: { Parts: String(files.length), Output: formatBytes(blob.size) } };
};

async function hashFile(file: File, onProgress?: (f: number) => void) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  onProgress?.(0.5);
  return allHashes(bytes);
}

export const hash: FileProcessor = async (files, { onProgress, signal }) => {
  const results: Record<string, string>[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const h = await hashFile(files[i], (f) => onProgress?.((i + f) / files.length));
    results.push({ file: files[i].name, size: formatBytes(files[i].size), ...h });
    onProgress?.((i + 1) / files.length);
  }
  const text = results.map((r) => `${r.file}\n  MD5:     ${r.md5}\n  SHA-1:   ${r.sha1}\n  SHA-256: ${r.sha256}\n  SHA-512: ${r.sha512}`).join("\n\n");
  return { files: [fileFromText("checksums.txt", text)], text, data: results.length === 1 ? results[0] : results };
};

export const metadata: FileProcessor = async (files) => {
  const results = [];
  for (const f of files) {
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    results.push({ name: f.name, size: formatBytes(f.size), bytes: f.size, declaredType: f.type || "(none)", detectedType: detectMime(head) ?? "unknown", extension: f.name.split(".").pop() ?? "", lastModified: new Date(f.lastModified).toISOString() });
  }
  return jsonOutput(results.length === 1 ? results[0] : results);
};

export const detectType: FileProcessor = async (files) => {
  const results = [];
  for (const f of files) {
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const detected = detectMime(head);
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const expected = mimeForExt(ext);
    results.push({ file: f.name, detected: detected ?? "unknown (no known signature)", declared: f.type || "(none)", extensionSuggests: expected, matchesExtension: detected ? detected === expected || (detected === "application/zip" && ["docx", "xlsx", "pptx"].includes(ext)) : null, signature: hex(head.slice(0, 8)) });
  }
  return jsonOutput(results.length === 1 ? results[0] : results);
};

export const duplicates: FileProcessor = async (files, { onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two files");
  const groups = new Map<string, string[]>();
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const h = await digest("SHA-256", new Uint8Array(await files[i].arrayBuffer()));
    groups.set(h, [...(groups.get(h) ?? []), files[i].name]);
    onProgress?.((i + 1) / files.length);
  }
  const dupes = [...groups.entries()].filter(([, n]) => n.length > 1);
  const text = dupes.length ? dupes.map(([h, n]) => `Identical (${h.slice(0, 12)}…):\n  ${n.join("\n  ")}`).join("\n\n") : "No duplicates found.";
  return textOutput(text, dupes, { "Duplicate groups": String(dupes.length), "Redundant files": String(dupes.reduce((a, [, n]) => a + n.length - 1, 0)) });
};

export const sizes: FileProcessor = async (files) => {
  const entries: { name: string; bytes: number }[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      try {
        const z = await JSZip.loadAsync(await f.arrayBuffer());
        for (const e of Object.values(z.files)) if (!e.dir) entries.push({ name: `${f.name}/${e.name}`, bytes: (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? (await e.async("uint8array")).length });
        continue;
      } catch { /* treat as ordinary file */ }
    }
    entries.push({ name: f.name, bytes: f.size });
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  const total = entries.reduce((a, e) => a + e.bytes, 0);
  const text = entries.map((e) => `${formatBytes(e.bytes).padStart(10)}  ${((e.bytes / total) * 100).toFixed(1).padStart(5)}%  ${e.name}`).join("\n");
  return textOutput(text, entries, { Total: formatBytes(total), Files: String(entries.length), Largest: entries[0]?.name ?? "" });
};

export const base64: FileProcessor = async (files, { options }) => {
  const outputs: ProcessorFile[] = [];
  let text = "";
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) throw new ProcessorError(`${f.name} is too large to Base64 in the browser (20 MB limit)`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const out = options.dataUri !== false ? `data:${f.type || "application/octet-stream"};base64,${b64}` : b64;
    text += (files.length > 1 ? `${f.name}:\n` : "") + out + "\n";
    outputs.push(fileFromText(`${f.name}.b64.txt`, out));
  }
  return { files: outputs, text: text.trim(), stats: { Length: `${text.length.toLocaleString()} chars` } };
};

export const hexDump: FileProcessor = async (files, { options }) => {
  const n = Math.min(65536, Math.max(16, Number(options.bytes ?? 512)));
  let text = "";
  for (const f of files) {
    const bytes = new Uint8Array(await f.slice(0, n).arrayBuffer());
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.subarray(i, i + 16);
      const hx = [...chunk].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47);
      const ascii = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
      lines.push(`${i.toString(16).padStart(8, "0")}  ${hx}  ${ascii}`);
    }
    text += (files.length > 1 ? `== ${f.name} ==\n` : "") + lines.join("\n") + "\n";
  }
  return textOutput(text.trim(), undefined, { Shown: `${n} bytes` });
};
export { hexDump as hex };
export { batchRename } from "./rename";
