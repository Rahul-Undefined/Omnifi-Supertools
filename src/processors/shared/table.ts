import * as XLSX from "xlsx";
import Papa from "papaparse";
import { ProcessorError, type ProcessorFile } from "@/types/processor";
import { baseName } from "@/lib/utils";

export type Cell = string | number | boolean | null;
export type Row = Cell[];

export interface Sheet {
  name: string;
  rows: Row[]; // rows[0] is the header row
}

export async function readSheets(file: File): Promise<Sheet[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", dynamicTyping: false });
    if (parsed.errors.length && parsed.data.length === 0) {
      throw new ProcessorError("Could not parse CSV", parsed.errors[0]?.message);
    }
    return [{ name: baseName(file.name).slice(0, 31) || "Sheet1", rows: parsed.data.map((r) => r.map(coerce)) }];
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  } catch (e) {
    throw new ProcessorError("Could not read this workbook", e instanceof Error ? e.message : undefined);
  }
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: null, raw: true, blankrows: false });
    return { name, rows: rows.map((r) => r.map((c) => ((c as unknown) instanceof Date ? (c as unknown as Date).toISOString().slice(0, 10) : (c as Cell)))) };
  });
}

function coerce(v: string): Cell {
  if (v === "" || v == null) return null;
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16 && !/^0\d/.test(t)) return Number(t);
  return v;
}

export function writeWorkbook(sheets: Sheet[]): Blob {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    let name = (s.name || "Sheet").replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
    let i = 1;
    while (used.has(name)) name = `${name.slice(0, 28)}_${i++}`;
    used.add(name);
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function xlsxFile(name: string, sheets: Sheet[]): ProcessorFile {
  const blob = writeWorkbook(sheets);
  return { name, blob, bytes: blob.size, mime: blob.type };
}

export function toCsv(rows: Row[]): string {
  return Papa.unparse(rows.map((r) => r.map((c) => (c == null ? "" : c))));
}

export function csvFile(name: string, rows: Row[]): ProcessorFile {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  return { name, blob, bytes: blob.size, mime: "text/csv" };
}

export function headerIndex(rows: Row[], header: string): number {
  if (!rows.length) return -1;
  const h = header.trim().toLowerCase();
  return rows[0].findIndex((c) => String(c ?? "").trim().toLowerCase() === h);
}

export function requireColumn(rows: Row[], header: string): number {
  const i = headerIndex(rows, header);
  if (i < 0) {
    const available = rows[0]?.map((c) => String(c ?? "")).filter(Boolean).join(", ") || "none";
    throw new ProcessorError(`Column "${header}" not found`, `Available columns: ${available}`);
  }
  return i;
}

export function splitList(s: string): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function cellText(c: Cell): string {
  return c == null ? "" : String(c);
}
