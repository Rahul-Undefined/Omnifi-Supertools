import Papa from "papaparse";
import type { FileProcessor, TextProcessor, ProcessorOutput } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { textOutput, fileFromText } from "../shared/output";
import { readSheets, xlsxFile, type Row } from "../shared/table";

/**
 * CSV / JSON / XML data utilities. Every tool accepts pasted text; the CSV
 * ones also accept uploaded .csv/.tsv/.xlsx files (first sheet).
 */

const str = (v: unknown, d = "") => (v == null || v === "" ? d : String(v));
const sepOf = (v: unknown) => { const s = str(v, "auto"); return s === "auto" ? undefined : s === "tab" ? "\t" : s === "semicolon" ? ";" : s === "pipe" ? "|" : s === "space" ? " " : ","; };

function parseCsv(text: string, delimiter?: string): string[][] {
  const r = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter: delimiter ?? "", skipEmptyLines: "greedy" });
  if (!r.data.length) throw new ProcessorError("No rows found");
  return r.data.map((row) => row.map((c) => (c ?? "").toString()));
}
const toCsv = (rows: unknown[][], delimiter = ",") => Papa.unparse(rows.map((r) => r.map((c) => (c == null ? "" : c))), { delimiter, newline: "\n" });
const header = (rows: string[][]) => rows[0].map((h, i) => (h.trim() || `column${i + 1}`));
const coerce = (v: string): string | number | boolean | null => { const t = v.trim(); if (t === "") return null; if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16 && !/^0\d/.test(t)) return Number(t); if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true"; return v; };
const xmlEsc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (s: string) => s.trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^([^A-Za-z_])/, "_$1") || "field";

/** Text tool with optional file: reads the first sheet of an uploaded file when input is empty. */
async function textOrFile(input: string, options: Record<string, unknown>): Promise<string> {
  if (input.trim()) return input;
  const f = options.__file as File | undefined;
  if (f) { if (/\.(xlsx|xls)$/i.test(f.name)) { const s = (await readSheets(f))[0]; return toCsv(s.rows); } return f.text(); }
  throw new ProcessorError("Paste CSV text first");
}

/* ---------- CSV conversions ---------- */

export const csvToJson: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows);
  const typed = options.typed !== false;
  const records = rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, typed ? coerce(r[i] ?? "") : (r[i] ?? "")])));
  const out = str(options.shape, "records") === "columns" ? Object.fromEntries(h.map((k, i) => [k, rows.slice(1).map((r) => (typed ? coerce(r[i] ?? "") : (r[i] ?? "")))])) : records;
  const text = JSON.stringify(out, null, options.minify ? 0 : 2);
  return { ...textOutput(text, out, { Rows: String(records.length), Columns: String(h.length) }), files: [fileFromText("data.json", text, "application/json")] };
};

export const jsonToCsv: TextProcessor = async (input, { options }) => {
  let data: unknown;
  try { data = JSON.parse(input); } catch (e) { throw new ProcessorError("Invalid JSON", e instanceof Error ? e.message : undefined); }
  const path = str(options.path);
  if (path) for (const k of path.split(".").filter(Boolean)) data = (data as Record<string, unknown>)?.[k];
  let records: Record<string, unknown>[];
  if (Array.isArray(data)) records = data.map((d) => (d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : { value: d }));
  else if (data && typeof data === "object") { const o = data as Record<string, unknown>; const arrKey = Object.keys(o).find((k) => Array.isArray(o[k])); records = arrKey && !path ? (o[arrKey] as Record<string, unknown>[]) : [o]; }
  else throw new ProcessorError("JSON must be an array of objects (or an object containing one)", "Use 'Path to array' for nested data, e.g. data.items");
  const flat = (obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> => { for (const [k, v] of Object.entries(obj)) { const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === "object" && !Array.isArray(v) && options.flatten !== false) flat(v as Record<string, unknown>, key, out); else out[key] = Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v; } return out; };
  const flatRecords = records.map((r) => flat(r));
  const cols = [...new Set(flatRecords.flatMap((r) => Object.keys(r)))];
  const rows = [cols, ...flatRecords.map((r) => cols.map((c) => r[c] ?? ""))];
  const text = toCsv(rows, sepOf(options.separator) ?? ",");
  return { ...textOutput(text, undefined, { Rows: String(records.length), Columns: String(cols.length) }), files: [fileFromText("data.csv", text, "text/csv"), xlsxFile("data.xlsx", [{ name: "Data", rows: rows as Row[] }])], data: { header: cols, rows: flatRecords.slice(0, 200).map((r) => cols.map((c) => String(r[c] ?? ""))) } };
};

export const csvToXml: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows).map(tag);
  const root = tag(str(options.root, "rows")), item = tag(str(options.item, "row"));
  const body = rows.slice(1).map((r) => `  <${item}>\n${h.map((k, i) => `    <${k}>${xmlEsc(r[i])}</${k}>`).join("\n")}\n  </${item}>`).join("\n");
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n${body}\n</${root}>`;
  return { ...textOutput(text, undefined, { Rows: String(rows.length - 1) }), files: [fileFromText("data.xml", text, "application/xml")] };
};

export const csvToYaml: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows);
  const yaml = await import("yaml");
  const records = rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, coerce(r[i] ?? "")])));
  const text = yaml.stringify(records);
  return { ...textOutput(text, records, { Rows: String(records.length) }), files: [fileFromText("data.yaml", text, "text/yaml")] };
};

export const changeSeparator: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.from));
  const to = sepOf(options.to) ?? ",";
  const text = toCsv(rows, to);
  const ext = to === "\t" ? "tsv" : "csv";
  return { ...textOutput(text, undefined, { Rows: String(rows.length), "New separator": to === "\t" ? "tab" : to }), files: [fileFromText(`data.${ext}`, text, "text/csv")] };
};

export const transposeCsv: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const cols = Math.max(...rows.map((r) => r.length));
  const out = Array.from({ length: cols }, (_, c) => rows.map((r) => r[c] ?? ""));
  const text = toCsv(out, sepOf(options.separator) ?? ",");
  return { ...textOutput(text, undefined, { Rows: String(out.length), Columns: String(rows.length) }), files: [fileFromText("transposed.csv", text, "text/csv")], data: { header: out[0], rows: out.slice(1, 201) } };
};

const colIndex = (h: string[], ref: string): number => { const t = ref.trim(); if (!t) return -1; const byName = h.findIndex((x) => x.toLowerCase() === t.toLowerCase()); if (byName >= 0) return byName; const n = Number(t); return Number.isInteger(n) && n >= 1 && n <= h.length ? n - 1 : -1; };

export const swapColumns: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows);
  const a = colIndex(h, str(options.a)), b = colIndex(h, str(options.b));
  if (a < 0 || b < 0) throw new ProcessorError("Column not found", `Use a header name or a 1-based number. Columns: ${h.join(", ")}`);
  const out = rows.map((r) => { const c = [...r]; [c[a], c[b]] = [c[b] ?? "", c[a] ?? ""]; return c; });
  const text = toCsv(out, sepOf(options.separator) ?? ",");
  return { ...textOutput(text, undefined, { Swapped: `${h[a]} ↔ ${h[b]}` }), files: [fileFromText("swapped.csv", text, "text/csv")], data: { header: out[0], rows: out.slice(1, 201) } };
};

export const insertColumn: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows);
  const name = str(options.name, "new_column");
  const posRef = str(options.position);
  let at = posRef ? colIndex(h, posRef) : h.length;
  if (at < 0) at = h.length;
  if (str(options.where, "after") === "after" && posRef) at += 1;
  const fill = str(options.fill);
  const mode = str(options.mode, "value");
  const out = rows.map((r, i) => { const c = [...r]; const v = i === 0 ? name : mode === "index" ? String(i) : mode === "formula" ? fill.replace(/\{(\w+)\}/g, (_, k) => { const ci = colIndex(h, k); return ci >= 0 ? (r[ci] ?? "") : ""; }) : fill; c.splice(at, 0, v); return c; });
  const text = toCsv(out, sepOf(options.separator) ?? ",");
  return { ...textOutput(text, undefined, { Column: name, Position: String(at + 1) }), files: [fileFromText("with-column.csv", text, "text/csv")], data: { header: out[0], rows: out.slice(1, 201) } };
};

export const incompleteRows: TextProcessor = async (input, { options }) => {
  const rows = parseCsv(await textOrFile(input, options), sepOf(options.separator));
  const h = header(rows);
  const bad: { line: number; reason: string; row: string[] }[] = [];
  const good: string[][] = [rows[0]];
  rows.slice(1).forEach((r, i) => {
    const reasons: string[] = [];
    if (r.length < h.length) reasons.push(`only ${r.length} of ${h.length} fields`);
    if (r.length > h.length) reasons.push(`${r.length - h.length} extra field(s)`);
    const empties = h.filter((_, c) => (r[c] ?? "").trim() === "");
    if (empties.length && options.emptyIsIncomplete !== false) reasons.push(`empty: ${empties.join(", ")}`);
    if (reasons.length) bad.push({ line: i + 2, reason: reasons.join("; "), row: r }); else good.push(r);
  });
  const text = bad.length ? bad.map((b) => `Line ${b.line}: ${b.reason}\n  ${b.row.join(" | ")}`).join("\n") : "Every row is complete.";
  const files = [fileFromText("incomplete-rows.csv", toCsv([["line", "reason", ...h], ...bad.map((b) => [b.line, b.reason, ...b.row])]), "text/csv"), fileFromText("complete-rows.csv", toCsv(good), "text/csv")];
  return { ...textOutput(text, bad, { Checked: String(rows.length - 1), Incomplete: String(bad.length) }), files };
};

export const tsvCsv: TextProcessor = async (input, { options }) => {
  const toTsv = str(options.direction, "csv-to-tsv") === "csv-to-tsv";
  const rows = parseCsv(await textOrFile(input, options), toTsv ? "," : "\t");
  const text = toCsv(rows, toTsv ? "\t" : ",");
  return { ...textOutput(text, undefined, { Rows: String(rows.length) }), files: [fileFromText(toTsv ? "data.tsv" : "data.csv", text, "text/csv")] };
};

/** File entry point: same tools, but driven by an uploaded CSV/TSV/XLSX. */
export const csvFileTool = (fn: TextProcessor): FileProcessor => async (files, ctx) => {
  const outputs: ProcessorOutput[] = [];
  for (const f of files) outputs.push(await fn("", { ...ctx, options: { ...ctx.options, __file: f as unknown as string } }));
  if (outputs.length === 1) return outputs[0];
  return { files: outputs.flatMap((o) => o.files), text: outputs.map((o) => o.text ?? "").join("\n\n"), stats: { Files: String(files.length) } };
};

/* ---------- JSON ---------- */

const parseJson = (s: string, label = "JSON") => { try { return JSON.parse(s); } catch (e) { throw new ProcessorError(`Invalid ${label}`, e instanceof Error ? e.message : undefined); } };

function sortKeysDeep(v: unknown, order: "asc" | "desc"): unknown {
  if (Array.isArray(v)) return v.map((x) => sortKeysDeep(x, order));
  if (v && typeof v === "object") { const keys = Object.keys(v as object).sort((a, b) => a.localeCompare(b)); if (order === "desc") keys.reverse(); return Object.fromEntries(keys.map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k], order)])); }
  return v;
}

export const jsonSortKeys: TextProcessor = async (input, { options }) => {
  const out = sortKeysDeep(parseJson(input), str(options.order, "asc") as "asc" | "desc");
  const text = JSON.stringify(out, null, options.minify ? 0 : 2);
  return { ...textOutput(text, out), files: [fileFromText("sorted.json", text, "application/json")] };
};

export const jsonEscape: TextProcessor = async (input, { options }) => {
  const mode = str(options.mode, "escape");
  if (mode === "unescape") {
    let s = input.trim();
    if (!(s.startsWith('"') && s.endsWith('"'))) s = `"${s}"`;
    const out = parseJson(s, "escaped string");
    return textOutput(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  }
  const value = mode === "stringify" ? (() => { try { return JSON.parse(input); } catch { return input; } })() : input;
  return textOutput(JSON.stringify(value), undefined, { Length: String(JSON.stringify(value).length) });
};

function diffJson(a: unknown, b: unknown, path = "$", out: string[] = []): string[] {
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a, tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) { out.push(`~ ${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return out; }
  if (ta === "array") { const A = a as unknown[], B = b as unknown[]; const n = Math.max(A.length, B.length); for (let i = 0; i < n; i++) { if (i >= A.length) out.push(`+ ${path}[${i}]: ${JSON.stringify(B[i])}`); else if (i >= B.length) out.push(`- ${path}[${i}]: ${JSON.stringify(A[i])}`); else diffJson(A[i], B[i], `${path}[${i}]`, out); } return out; }
  if (ta === "object") { const A = a as Record<string, unknown>, B = b as Record<string, unknown>; for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) { if (!(k in A)) out.push(`+ ${path}.${k}: ${JSON.stringify(B[k])}`); else if (!(k in B)) out.push(`- ${path}.${k}: ${JSON.stringify(A[k])}`); else diffJson(A[k], B[k], `${path}.${k}`, out); } return out; }
  if (a !== b) out.push(`~ ${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}

export const jsonCompare: TextProcessor = async (input, { options }) => {
  const a = parseJson(input, "JSON A"), b = parseJson(str(options.b), "JSON B");
  const diffs = diffJson(a, b);
  const text = diffs.length ? diffs.join("\n") : "The two JSON documents are identical.";
  const added = diffs.filter((d) => d.startsWith("+")).length, removed = diffs.filter((d) => d.startsWith("-")).length, changed = diffs.filter((d) => d.startsWith("~")).length;
  return textOutput(text, diffs, { Added: String(added), Removed: String(removed), Changed: String(changed) });
};

/* ---------- XML ---------- */

export const xmlValidate: TextProcessor = async (input) => {
  if (!input.trim()) throw new ProcessorError("Paste some XML");
  const doc = new DOMParser().parseFromString(input, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    const msg = err.textContent?.replace(/\s+/g, " ").trim() ?? "Parse error";
    const m = msg.match(/line (\d+)/i);
    return textOutput(`NOT well-formed.\n${msg}`, { ok: false, message: msg }, { Result: "Invalid", ...(m ? { Line: m[1] } : {}) });
  }
  const count = doc.getElementsByTagName("*").length;
  const root = doc.documentElement.tagName;
  return textOutput(`Well-formed XML.\nRoot element: <${root}>\nElements: ${count}`, { ok: true, root, elements: count }, { Result: "Valid", Root: root, Elements: String(count) });
};
export const csvToJsonFile = csvFileTool(csvToJson);
export const csvToXmlFile = csvFileTool(csvToXml);
export const csvToYamlFile = csvFileTool(csvToYaml);
export const transposeCsvFile = csvFileTool(transposeCsv);
export const incompleteRowsFile = csvFileTool(incompleteRows);
