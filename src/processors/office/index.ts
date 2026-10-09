import JSZip from "jszip";
import type { FileProcessor, ProcessorFile, ProcessorOutput } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, withSuffix, formatBytes } from "@/lib/utils";
import { readSheets, xlsxFile, csvFile, requireColumn, headerIndex, splitList, cellText, type Row, type Sheet } from "../shared/table";
import { parseDate, formatDate, type DateAssumption } from "../shared/dates";
import { maybeZip, zipFiles } from "../shared/zip";
import { fileFromText, jsonOutput } from "../shared/output";
import { diffLines, formatDiff, diffSummary } from "../shared/diff";

async function eachFile(
  files: File[],
  onProgress: ((f: number, l?: string) => void) | undefined,
  signal: AbortSignal | undefined,
  fn: (file: File, sheets: Sheet[]) => Promise<ProcessorFile | ProcessorFile[]>,
) {
  const out: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const r = await fn(files[i], await readSheets(files[i]));
    out.push(...(Array.isArray(r) ? r : [r]));
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return out;
}

export const csvToExcel: FileProcessor = async (files, { options, onProgress, signal }): Promise<ProcessorOutput> => {
  if (options.combine && files.length > 1) {
    const sheets: Sheet[] = [];
    for (const f of files) sheets.push(...(await readSheets(f)));
    return { files: [xlsxFile("combined.xlsx", sheets)], stats: { Sheets: String(sheets.length) } };
  }
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => xlsxFile(`${baseName(file.name)}.xlsx`, sheets));
  return { files: outputs, stats: { Files: String(outputs.length) } };
};

export const excelToCsv: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) =>
    sheets.map((s) => csvFile(sheets.length === 1 ? `${baseName(file.name)}.csv` : `${baseName(file.name)}-${s.name}.csv`, s.rows)),
  );
  return { files: await maybeZip(outputs, "csv-export.zip"), stats: { "CSV files": String(outputs.length) } };
};

export const dedupe: FileProcessor = async (files, { options, onProgress, signal }) => {
  const keyCols = splitList(String(options.columns ?? ""));
  const ci = Boolean(options.caseInsensitive ?? true);
  let removed = 0;
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const cleaned = sheets.map((s) => {
      if (!s.rows.length) return s;
      const idx = keyCols.length ? keyCols.map((c) => requireColumn(s.rows, c)) : null;
      const seen = new Set<string>();
      const rows: Row[] = [s.rows[0]];
      for (const r of s.rows.slice(1)) {
        const parts = (idx ? idx.map((i) => r[i]) : r).map(cellText);
        const key = (ci ? parts.map((p) => p.toLowerCase()) : parts).join("\u0001");
        if (seen.has(key)) { removed++; continue; }
        seen.add(key);
        rows.push(r);
      }
      return { name: s.name, rows };
    });
    return xlsxFile(withSuffix(file.name, "-deduped", "xlsx"), cleaned);
  });
  return { files: outputs, stats: { "Duplicates removed": String(removed) } };
};

export const clean: FileProcessor = async (files, { options, onProgress, signal }) => {
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const cleaned = sheets.map((s) => {
      let rows = s.rows.map((r) => r.map((c) => (options.trim !== false && typeof c === "string" ? c.trim().replace(/\s+/g, " ") : c)));
      if (options.dropEmptyRows !== false) rows = rows.filter((r) => r.some((c) => c != null && cellText(c) !== ""));
      if (options.dropEmptyCols !== false && rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const keep: number[] = [];
        for (let c = 0; c < width; c++) if (rows.some((r) => r[c] != null && cellText(r[c]) !== "")) keep.push(c);
        rows = rows.map((r) => keep.map((c) => r[c] ?? null));
      }
      if (options.snakeHeaders && rows.length) {
        rows[0] = rows[0].map((h) => cellText(h).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
      }
      return { name: s.name, rows };
    });
    return xlsxFile(withSuffix(file.name, "-clean", "xlsx"), cleaned);
  });
  return { files: outputs };
};

export const splitColumn: FileProcessor = async (files, { options, onProgress, signal }) => {
  const column = String(options.column ?? "");
  const delim = String(options.delimiter ?? " ");
  if (!column) throw new ProcessorError("Enter the column header to split");
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const out = sheets.map((s) => {
      const i = headerIndex(s.rows, column);
      if (i < 0) return s;
      const parts = s.rows.slice(1).map((r) => cellText(r[i]).split(delim));
      const n = Math.max(1, ...parts.map((p) => p.length));
      const header = [...s.rows[0].slice(0, i + 1), ...Array.from({ length: n }, (_, k) => `${column} ${k + 1}`), ...s.rows[0].slice(i + 1)];
      const rows = s.rows.slice(1).map((r, ri) => [...r.slice(0, i + 1), ...Array.from({ length: n }, (_, k) => parts[ri][k] ?? ""), ...r.slice(i + 1)]);
      return { name: s.name, rows: [header, ...rows] };
    });
    return xlsxFile(withSuffix(file.name, "-split", "xlsx"), out);
  });
  return { files: outputs };
};

export const mergeColumns: FileProcessor = async (files, { options, onProgress, signal }) => {
  const cols = splitList(String(options.columns ?? ""));
  const sep = String(options.separator ?? " ");
  const target = String(options.target ?? "Merged") || "Merged";
  if (cols.length < 2) throw new ProcessorError("Enter at least two columns to merge");
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const out = sheets.map((s) => {
      if (!s.rows.length) return s;
      const idx = cols.map((c) => requireColumn(s.rows, c));
      const rows = s.rows.map((r, ri) => [...r, ri === 0 ? target : idx.map((i) => cellText(r[i])).filter(Boolean).join(sep)]);
      return { name: s.name, rows };
    });
    return xlsxFile(withSuffix(file.name, "-merged-cols", "xlsx"), out);
  });
  return { files: outputs };
};

export const mergeSheets: FileProcessor = async (files, { options, onProgress }) => {
  const addSource = options.sourceColumn !== false;
  let header: Row | null = null;
  const rows: Row[] = [];
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    for (const s of await readSheets(files[i])) {
      if (!s.rows.length) continue;
      const h = s.rows[0].map(cellText);
      if (!header) {
        header = addSource ? [...h, "Source"] : h;
        rows.push(header);
      }
      const map = header.slice(0, addSource ? -1 : undefined).map((name) => h.findIndex((x) => x.toLowerCase() === cellText(name).toLowerCase()));
      for (const r of s.rows.slice(1)) {
        const row = map.map((j) => (j >= 0 ? (r[j] ?? null) : null));
        rows.push(addSource ? [...row, `${files[i].name} / ${s.name}`] : row);
        count++;
      }
    }
    onProgress?.((i + 1) / files.length);
  }
  if (!header) throw new ProcessorError("No data found");
  return { files: [xlsxFile("merged.xlsx", [{ name: "Merged", rows }])], stats: { Rows: String(count), Sources: String(files.length) } };
};

export const extractSheets: FileProcessor = async (files, { onProgress, signal }) => {
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) =>
    sheets.map((s) => xlsxFile(`${baseName(file.name)}-${s.name}.xlsx`, [s])),
  );
  return { files: await maybeZip(outputs, "sheets.zip"), stats: { Sheets: String(outputs.length) } };
};

export const compare: FileProcessor = async (files, { options }) => {
  if (files.length !== 2) throw new ProcessorError("Upload exactly two spreadsheets");
  const [a, b] = await Promise.all(files.map(readSheets));
  const keyCol = String(options.keyColumn ?? "").trim();
  const diffs: Row[] = [["Sheet", "Row / Key", "Column", files[0].name, files[1].name, "Change"]];
  const summary = { changed: 0, added: 0, removed: 0 };
  for (const sa of a) {
    const sb = b.find((s) => s.name === sa.name) ?? b[a.indexOf(sa)];
    if (!sb) { diffs.push([sa.name, "", "", "(sheet present)", "(sheet missing)", "removed"]); continue; }
    const header = sa.rows[0] ?? [];
    const keyIdx = keyCol ? headerIndex(sa.rows, keyCol) : -1;
    const keyOf = (r: Row, i: number) => (keyIdx >= 0 ? cellText(r[keyIdx]) : String(i + 1));
    const mapA = new Map(sa.rows.slice(1).map((r, i) => [keyOf(r, i), r]));
    const mapB = new Map(sb.rows.slice(1).map((r, i) => [keyOf(r, i), r]));
    for (const [k, ra] of mapA) {
      const rb = mapB.get(k);
      if (!rb) { diffs.push([sa.name, k, "", ra.map(cellText).join(" | "), "", "removed"]); summary.removed++; continue; }
      const width = Math.max(ra.length, rb.length);
      for (let c = 0; c < width; c++) {
        if (cellText(ra[c]) !== cellText(rb[c])) { diffs.push([sa.name, k, cellText(header[c]) || `Col ${c + 1}`, ra[c] ?? "", rb[c] ?? "", "changed"]); summary.changed++; }
      }
    }
    for (const [k, rb] of mapB) if (!mapA.has(k)) { diffs.push([sa.name, k, "", "", rb.map(cellText).join(" | "), "added"]); summary.added++; }
  }
  for (const sb of b) if (!a.find((s) => s.name === sb.name) && b.indexOf(sb) >= a.length) diffs.push([sb.name, "", "", "(sheet missing)", "(sheet present)", "added"]);
  const text = diffs.length === 1 ? "No differences found." : `${summary.changed} changed, ${summary.added} added, ${summary.removed} removed cells/rows.`;
  return { files: [xlsxFile("comparison.xlsx", [{ name: "Differences", rows: diffs }])], text, data: diffs.slice(1), stats: { Changed: String(summary.changed), Added: String(summary.added), Removed: String(summary.removed) } };
};

export const formatDates: FileProcessor = async (files, { options, onProgress, signal }) => {
  const column = String(options.column ?? "Date");
  const fmt = String(options.format ?? "yyyy-mm-dd");
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  let converted = 0;
  let failed = 0;
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const out = sheets.map((s) => {
      const i = headerIndex(s.rows, column);
      if (i < 0) return s;
      const rows = s.rows.map((r, ri) => {
        if (ri === 0) return r;
        const d = parseDate(r[i], assume);
        if (d) { converted++; const copy = [...r]; copy[i] = formatDate(d, fmt); return copy; }
        if (r[i] != null && cellText(r[i]) !== "") failed++;
        return r;
      });
      return { name: s.name, rows };
    });
    return xlsxFile(withSuffix(file.name, "-dates", "xlsx"), out);
  });
  if (!converted && !failed) throw new ProcessorError(`Column "${column}" not found in any sheet`);
  return { files: outputs, stats: { Converted: String(converted), Unrecognised: String(failed) }, warnings: failed ? [`${failed} values could not be parsed as dates and were left unchanged.`] : undefined };
};

export const formatData: FileProcessor = async (files, { options, onProgress, signal }) => {
  const numCols = splitList(String(options.numberColumns ?? ""));
  const decimals = Math.max(0, Number(options.decimals ?? 2));
  const upper = splitList(String(options.upperColumns ?? ""));
  const title = splitList(String(options.titleColumns ?? ""));
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const outputs = await eachFile(files, onProgress, signal, async (file, sheets) => {
    const out = sheets.map((s) => {
      const ni = numCols.map((c) => headerIndex(s.rows, c)).filter((i) => i >= 0);
      const ui = upper.map((c) => headerIndex(s.rows, c)).filter((i) => i >= 0);
      const ti = title.map((c) => headerIndex(s.rows, c)).filter((i) => i >= 0);
      const rows = s.rows.map((r, ri) => {
        if (ri === 0) return r;
        const copy = [...r];
        for (const i of ni) { const n = Number(String(copy[i] ?? "").replace(/[^0-9.\-]/g, "")); if (copy[i] != null && !isNaN(n) && cellText(copy[i]) !== "") copy[i] = Number(n.toFixed(decimals)); }
        for (const i of ui) copy[i] = cellText(copy[i]).toUpperCase();
        for (const i of ti) copy[i] = titleCase(cellText(copy[i]));
        return copy;
      });
      return { name: s.name, rows };
    });
    return xlsxFile(withSuffix(file.name, "-formatted", "xlsx"), out);
  });
  return { files: outputs };
};

/* ---------- DOCX / PPTX (OOXML zip parsing, no external libs) ---------- */

async function openOoxml(file: File): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ProcessorError(`${file.name} is not a valid Office file`, "Only .docx, .xlsx and .pptx (Office 2007+) are supported.");
  }
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function xmlToText(xml: string, paragraphTag: string): string {
  return decodeXml(
    xml
      .replace(new RegExp(`</${paragraphTag}>`, "g"), "\n")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function docxText(file: File): Promise<string> {
  const zip = await openOoxml(file);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new ProcessorError(`${file.name} has no document body`);
  return xmlToText(await doc.async("string"), "w:p");
}

export const docxTextProcessor: FileProcessor = async (files, { onProgress }) => {
  const outputs: ProcessorFile[] = [];
  let all = "";
  for (let i = 0; i < files.length; i++) {
    const text = await docxText(files[i]);
    all += (files.length > 1 ? `===== ${files[i].name} =====\n` : "") + text + "\n";
    outputs.push(fileFromText(`${baseName(files[i].name)}.txt`, text));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, text: all.trim(), stats: { Characters: all.length.toLocaleString() } };
};
export { docxTextProcessor as docxText };

export const docxCompare: FileProcessor = async (files) => {
  if (files.length !== 2) throw new ProcessorError("Upload exactly two DOCX files");
  const [a, b] = await Promise.all(files.map(docxText));
  const ops = diffLines(a, b);
  const s = diffSummary(ops);
  const text = formatDiff(ops);
  return { files: [fileFromText("comparison.diff.txt", text)], text, data: ops, stats: { Added: String(s.added), Removed: String(s.removed), Unchanged: String(s.unchanged) } };
};

export const pptxText: FileProcessor = async (files, { onProgress }) => {
  const outputs: ProcessorFile[] = [];
  let all = "";
  for (let i = 0; i < files.length; i++) {
    const zip = await openOoxml(files[i]);
    const slides = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((x, y) => Number(x.match(/\d+/)![0]) - Number(y.match(/\d+/)![0]));
    if (!slides.length) throw new ProcessorError(`${files[i].name} contains no slides`);
    const parts: string[] = [];
    for (let k = 0; k < slides.length; k++) {
      const xml = await zip.file(slides[k])!.async("string");
      parts.push(`--- Slide ${k + 1} ---\n${xmlToText(xml, "a:p")}`);
    }
    const text = parts.join("\n\n");
    all += (files.length > 1 ? `===== ${files[i].name} =====\n` : "") + text + "\n";
    outputs.push(fileFromText(`${baseName(files[i].name)}-slides.txt`, text));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, text: all.trim() };
};

export const pptxImages: FileProcessor = async (files, { onProgress }) => {
  const outputs: ProcessorFile[] = [];
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    const zip = await openOoxml(files[i]);
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n) && !zip.files[n].dir);
    if (!media.length) throw new ProcessorError(`${files[i].name} has no embedded images`);
    const imgs: ProcessorFile[] = [];
    for (const m of media) {
      const blob = await zip.file(m)!.async("blob");
      imgs.push({ name: m.split("/").pop()!, blob, bytes: blob.size });
    }
    total += imgs.length;
    outputs.push(await zipFiles(imgs, `${baseName(files[i].name)}-images.zip`));
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, stats: { Images: String(total) } };
};

export const metadata: FileProcessor = async (files) => {
  const results: Record<string, unknown>[] = [];
  for (const file of files) {
    const zip = await openOoxml(file);
    const grab = (xml: string, tag: string) => decodeXml(xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] ?? "");
    const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
    const app = (await zip.file("docProps/app.xml")?.async("string")) ?? "";
    results.push({
      file: file.name,
      size: formatBytes(file.size),
      title: grab(core, "dc:title"),
      subject: grab(core, "dc:subject"),
      creator: grab(core, "dc:creator"),
      lastModifiedBy: grab(core, "cp:lastModifiedBy"),
      created: grab(core, "dcterms:created"),
      modified: grab(core, "dcterms:modified"),
      revision: grab(core, "cp:revision"),
      keywords: grab(core, "cp:keywords"),
      application: grab(app, "Application"),
      appVersion: grab(app, "AppVersion"),
      company: grab(app, "Company"),
      pages: grab(app, "Pages"),
      words: grab(app, "Words"),
      slides: grab(app, "Slides"),
      totalTime: grab(app, "TotalTime"),
    });
  }
  return jsonOutput(results.length === 1 ? results[0] : results);
};

export { excelToPdf, docxToPdf, pptxToPdf } from "./topdf";
