import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { baseName, extOf, formatBytes } from "@/lib/utils";
import { zipFiles } from "../shared/zip";
import { fileFromText } from "../shared/output";

export interface RenameOptions {
  pattern: string;
  find: string;
  replace: string;
  regex: boolean;
  caseMode: "keep" | "lower" | "upper" | "title" | "slug";
  start: number;
  sort: "name" | "size" | "date" | "upload";
  dateSource: "today" | "modified";
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Compute new names without touching any file. Exported for tests. */
export function planRenames(files: { name: string; size: number; lastModified: number }[], o: RenameOptions): { from: string; to: string }[] {
  const list = [...files];
  if (o.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (o.sort === "size") list.sort((a, b) => a.size - b.size);
  if (o.sort === "date") list.sort((a, b) => a.lastModified - b.lastModified);
  const width = String(o.start + list.length - 1).length;
  let re: RegExp | null = null;
  if (o.find) {
    try { re = o.regex ? new RegExp(o.find, "g") : new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); }
    catch (e) { throw new ProcessorError("Invalid regular expression", e instanceof Error ? e.message : undefined); }
  }
  const used = new Set<string>();
  return list.map((f, i) => {
    const n = o.start + i;
    let base = baseName(f.name);
    if (re) base = base.replace(re, o.replace);
    const d = new Date(o.dateSource === "modified" && f.lastModified ? f.lastModified : Date.now());
    const ext = extOf(f.name);
    const vars: Record<string, string> = {
      name: base,
      original: baseName(f.name),
      n: String(n),
      nn: pad(n, Math.max(2, width)),
      nnn: pad(n, Math.max(3, width)),
      ext,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`,
      yyyy: String(d.getFullYear()),
      mm: pad(d.getMonth() + 1, 2),
      dd: pad(d.getDate(), 2),
      time: `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`,
      size: formatBytes(f.size).replace(/\s/g, ""),
    };
    let out = (o.pattern || "{name}").replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
    switch (o.caseMode) {
      case "lower": out = out.toLowerCase(); break;
      case "upper": out = out.toUpperCase(); break;
      case "title": out = out.toLowerCase().replace(/(^|[\s_-])(\w)/g, (m, s, c) => s + c.toUpperCase()); break;
      case "slug": out = out.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); break;
    }
    out = out.replace(/[\\/:*?"<>|]/g, "_").trim() || `file-${n}`;
    let full = ext ? `${out}.${ext}` : out;
    let k = 2;
    while (used.has(full.toLowerCase())) { full = ext ? `${out} (${k}).${ext}` : `${out} (${k})`; k++; }
    used.add(full.toLowerCase());
    return { from: f.name, to: full };
  });
}

export const batchRename: FileProcessor = async (files, { options, onProgress }) => {
  const o: RenameOptions = {
    pattern: String(options.pattern ?? "{name}"),
    find: String(options.find ?? ""),
    replace: String(options.replace ?? ""),
    regex: Boolean(options.regex),
    caseMode: String(options.caseMode ?? "keep") as RenameOptions["caseMode"],
    start: Math.max(0, Math.floor(Number(options.start ?? 1))),
    sort: String(options.sort ?? "name") as RenameOptions["sort"],
    dateSource: String(options.dateSource ?? "today") as RenameOptions["dateSource"],
  };
  const plan = planRenames(files, o);
  const byName = new Map(files.map((f) => [f.name, f]));
  const renamed: ProcessorFile[] = plan.map((p) => { const f = byName.get(p.from)!; return { name: p.to, blob: f, bytes: f.size, mime: f.type }; });
  onProgress?.(0.5, "Packing");
  const mapping = "Original,New\n" + plan.map((p) => `"${p.from.replace(/"/g, '""')}","${p.to.replace(/"/g, '""')}"`).join("\n");
  const zip = await zipFiles([...renamed, fileFromText("rename-map.csv", mapping, "text/csv")], "renamed-files.zip", 0);
  onProgress?.(1);
  const changed = plan.filter((p) => p.from !== p.to).length;
  return {
    files: [zip],
    text: plan.map((p) => `${p.from}  →  ${p.to}`).join("\n"),
    data: { header: ["Original", "New name"], rows: plan.map((p) => [p.from, p.to]) },
    stats: { Files: String(files.length), Renamed: String(changed), Unchanged: String(files.length - changed) },
    warnings: changed === 0 ? ["No name changed. Adjust the pattern or find/replace."] : [],
  };
};
