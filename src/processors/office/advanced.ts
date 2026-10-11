import * as XLSX from "xlsx";
import type { FileProcessor, ProcessorFile, TextProcessor } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName } from "@/lib/utils";
import { readSheets, xlsxFile, cellText, type Row, type Sheet } from "../shared/table";
import { fileFromText, textOutput } from "../shared/output";
import { analyzeFormula, formatAnalysis, relativeForm, VOLATILE, type Issue } from "./formula";

/* ---------- Excel formula explainer & debugger (text tool) ---------- */

export const explainFormula: TextProcessor = async (input) => {
  const formulas = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!formulas.length) throw new ProcessorError("Paste a formula first", "Example: =IF(VLOOKUP(A2,Rates!A:B,2),B2*1.08,0)");
  const results = formulas.map((f) => analyzeFormula(f));
  const text = results.map((r) => formatAnalysis(r)).join("\n\n" + "=".repeat(60) + "\n\n");
  const errors = results.reduce((n, r) => n + r.issues.filter((i) => i.level === "error").length, 0);
  const warnings = results.reduce((n, r) => n + r.issues.filter((i) => i.level === "warning").length, 0);
  return textOutput(text, results.map((r) => ({ formula: r.formula, functions: r.functions, refs: r.refs, issues: r.issues })), {
    Formulas: String(results.length),
    Errors: String(errors),
    Warnings: String(warnings),
    Functions: String(new Set(results.flatMap((r) => r.functions)).size),
  });
};

/* ---------- Multi-file Excel consolidator ---------- */

export const consolidate: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "stack");
  const headerRow = Math.max(1, Number(options.headerRow ?? 1));
  const addSource = options.addSource !== false;
  const sheetFilter = String(options.sheetFilter ?? "").trim().toLowerCase();
  const matchHeaders = options.matchHeaders !== false;

  const sources: { file: string; sheet: string; rows: Row[] }[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = await readSheets(files[i]);
    for (const s of sheets) {
      if (sheetFilter && !s.name.toLowerCase().includes(sheetFilter)) continue;
      const rows = s.rows.slice(headerRow - 1);
      if (!rows.length || !rows[0].some((c) => c != null && String(c).trim())) continue;
      sources.push({ file: files[i].name, sheet: s.name, rows });
    }
    onProgress?.((i + 1) / (files.length + 1), files[i].name);
  }
  if (!sources.length) throw new ProcessorError("No data found", sheetFilter ? `No sheet name contains "${sheetFilter}".` : "The workbooks have no rows below the header.");

  const summary: Row[] = [["File", "Sheet", "Rows", "Columns"]];
  const out: Sheet[] = [];
  let totalRows = 0;

  if (mode === "sheets") {
    for (const s of sources) {
      const name = files.length > 1 && sources.filter((x) => x.file === s.file).length === 1 ? baseName(s.file) : `${baseName(s.file)}-${s.sheet}`;
      out.push({ name: name.slice(0, 31), rows: s.rows });
      summary.push([s.file, s.sheet, s.rows.length - 1, s.rows[0].length]);
      totalRows += s.rows.length - 1;
    }
  } else {
    // Stack: union of headers (matched by name, case-insensitive) or positional.
    const headers: string[] = [];
    const key = (h: unknown) => String(h ?? "").trim().toLowerCase();
    if (matchHeaders) {
      for (const s of sources) for (const h of s.rows[0]) { const k = key(h); if (k && !headers.some((x) => key(x) === k)) headers.push(String(h).trim()); }
    } else {
      const width = Math.max(...sources.map((s) => s.rows[0].length));
      for (let c = 0; c < width; c++) headers.push(String(sources[0].rows[0][c] ?? `Column ${c + 1}`));
    }
    const rows: Row[] = [[...(addSource ? ["Source file", "Source sheet"] : []), ...headers]];
    for (const s of sources) {
      const map = matchHeaders ? headers.map((h) => s.rows[0].findIndex((x) => key(x) === key(h))) : headers.map((_, c) => c);
      for (const r of s.rows.slice(1)) {
        if (!r.some((c) => c != null && String(c).trim() !== "")) continue;
        rows.push([...(addSource ? [s.file, s.sheet] : []), ...map.map((i) => (i >= 0 ? r[i] ?? null : null))]);
      }
      const n = s.rows.length - 1;
      summary.push([s.file, s.sheet, n, s.rows[0].length]);
      totalRows += n;
    }
    out.push({ name: "Consolidated", rows });
    if (matchHeaders) {
      // Report headers that only appear in some sources: the usual cause of "my column is empty".
      const missing: Row[] = [["Header", "Missing from"]];
      for (const h of headers) {
        const absent = sources.filter((s) => !s.rows[0].some((x) => key(x) === key(h))).map((s) => `${s.file} / ${s.sheet}`);
        if (absent.length) missing.push([h, absent.join("; ")]);
      }
      if (missing.length > 1) out.push({ name: "Header gaps", rows: missing });
    }
  }
  out.push({ name: "Sources", rows: summary });
  onProgress?.(1);
  const warnings: string[] = [];
  const gaps = out.find((s) => s.name === "Header gaps");
  if (gaps) warnings.push(`${gaps.rows.length - 1} header(s) exist in only some files; see the "Header gaps" sheet.`);
  return { files: [xlsxFile("consolidated.xlsx", out)], stats: { Files: String(files.length), Sources: String(sources.length), Rows: totalRows.toLocaleString() }, warnings };
};

/* ---------- Excel formula audit ---------- */

interface FormulaCell { sheet: string; addr: string; r: number; c: number; formula: string; rel: string; value: unknown; error?: string }

export const formulaAudit: FileProcessor = async (files, { options, onProgress, signal }) => {
  const includeList = options.includeList !== false;
  const outputs: ProcessorFile[] = [];
  let grandFormulas = 0;
  let grandIssues = 0;
  const reportLines: string[] = [];

  for (let fi = 0; fi < files.length; fi++) {
    throwIfAborted(signal);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(await files[fi].arrayBuffer(), { type: "array", cellFormula: true, cellNF: true });
    } catch (e) {
      throw new ProcessorError(`Could not read ${files[fi].name}`, e instanceof Error ? e.message : undefined);
    }
    const cells: FormulaCell[] = [];
    const errorCells: { sheet: string; addr: string; value: string }[] = [];
    const externalLinks = new Set<string>();
    const sheetStats: Row[] = [["Sheet", "Formulas", "Cells with errors", "Volatile", "Issues"]];

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      let formulas = 0, errs = 0, volatile = 0;
      for (const addr of Object.keys(ws)) {
        if (addr[0] === "!") continue;
        const cell = ws[addr] as XLSX.CellObject;
        const { r, c } = XLSX.utils.decode_cell(addr);
        if (cell.t === "e") { errs++; errorCells.push({ sheet: name, addr, value: String(cell.w ?? cell.v) }); }
        if (!cell.f) continue;
        formulas++;
        const f = "=" + cell.f;
        if (/\[[^\]]+\]/.test(f)) { for (const m of f.matchAll(/\[([^\]]+)\]/g)) if (/\.\w{2,5}$/i.test(m[1])) externalLinks.add(m[1]); }
        if ([...VOLATILE].some((v) => new RegExp(`\\b${v.replace(".", "\\.")}\\(`).test(f.toUpperCase()))) volatile++;
        cells.push({ sheet: name, addr, r, c, formula: f, rel: relativeForm(cell.f, r + 1, c + 1), value: cell.v, error: cell.t === "e" ? String(cell.w ?? cell.v) : undefined });
      }
      sheetStats.push([name, formulas, errs, volatile, 0]);
      onProgress?.((fi + 0.5) / files.length, name);
    }
    if (!cells.length && files.length === 1) throw new ProcessorError("No formulas found", "This workbook contains only values (or it is a CSV).");

    // Analyse each formula, de-duplicating identical relative formulas for speed.
    const issuesRows: Row[] = [["Sheet", "Cell", "Level", "Issue", "Suggested fix", "Formula"]];
    const listRows: Row[] = [["Sheet", "Cell", "Formula", "Current value", "Functions", "Issues"]];
    const funcCount = new Map<string, number>();
    const cache = new Map<string, ReturnType<typeof analyzeFormula>>();
    const perSheetIssues = new Map<string, number>();
    const bySheet = new Map<string, FormulaCell[]>();
    for (const cell of cells) {
      if (!bySheet.has(cell.sheet)) bySheet.set(cell.sheet, []);
      bySheet.get(cell.sheet)!.push(cell);
    }
    for (const [sheet, list] of bySheet) {
      throwIfAborted(signal);
      const grid = new Map<string, FormulaCell>();
      for (const c of list) grid.set(`${c.r},${c.c}`, c);
      for (const cell of list) {
        let a = cache.get(cell.rel);
        if (!a) { a = analyzeFormula(cell.formula); cache.set(cell.rel, a); }
        for (const fn of a.functions) funcCount.set(fn, (funcCount.get(fn) ?? 0) + 1);
        const issues: Issue[] = a.issues.filter((i) => i.level !== "info" || /Hard-coded|volatile|another workbook/.test(i.message));
        if (cell.error) issues.unshift({ level: "error", message: `Currently evaluates to ${cell.error}`, fix: cell.error === "#REF!" ? "A referenced cell or sheet was deleted." : cell.error === "#N/A" ? "The lookup value was not found." : cell.error === "#DIV/0!" ? "The divisor is zero or empty." : undefined });
        // Inconsistency: neighbours left+right (or up+down) agree with each other but not with this cell.
        const L = grid.get(`${cell.r},${cell.c - 1}`), R = grid.get(`${cell.r},${cell.c + 1}`), U = grid.get(`${cell.r - 1},${cell.c}`), D = grid.get(`${cell.r + 1},${cell.c}`);
        if ((U && D && U.rel === D.rel && U.rel !== cell.rel) || (L && R && L.rel === R.rel && L.rel !== cell.rel)) {
          issues.push({ level: "warning", message: "Formula differs from the cells around it", fix: `Neighbours use ${(U && D && U.rel === D.rel ? U : L)!.formula}. Check whether this one was overwritten by hand.` });
        }
        if (cell.formula.length > 300) issues.push({ level: "info", message: `Very long formula (${cell.formula.length} characters)`, fix: "Break it into helper columns or LET()." });
        for (const i of issues) issuesRows.push([sheet, cell.addr, i.level, i.message, i.fix ?? "", cell.formula]);
        perSheetIssues.set(sheet, (perSheetIssues.get(sheet) ?? 0) + issues.length);
        if (includeList) listRows.push([sheet, cell.addr, cell.formula, cell.value == null ? "" : cellText(cell.value as string | number | boolean), a.functions.join(", "), issues.length]);
      }
    }
    for (const row of sheetStats.slice(1)) row[4] = perSheetIssues.get(String(row[0])) ?? 0;

    // Hard-coded values in otherwise-formula columns: a number typed over a formula.
    const overwritten: Row[] = [["Sheet", "Cell", "Typed value", "Formula above", "Formula below"]];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const list = bySheet.get(name) ?? [];
      const grid = new Map(list.map((c) => [`${c.r},${c.c}`, c]));
      for (const addr of Object.keys(ws)) {
        if (addr[0] === "!") continue;
        const cell = ws[addr] as XLSX.CellObject;
        if (cell.f || cell.t !== "n") continue;
        const { r, c } = XLSX.utils.decode_cell(addr);
        const U = grid.get(`${r - 1},${c}`), D = grid.get(`${r + 1},${c}`);
        if (U && D && U.rel === D.rel) overwritten.push([name, addr, cell.v as number, U.formula, D.formula]);
      }
    }

    const nErr = issuesRows.slice(1).filter((r) => r[2] === "error").length;
    const nWarn = issuesRows.slice(1).filter((r) => r[2] === "warning").length;
    const summary: Row[] = [
      ["Workbook", files[fi].name],
      ["Sheets", wb.SheetNames.length],
      ["Formulas", cells.length],
      ["Distinct formulas (relative)", cache.size],
      ["Cells showing an error", errorCells.length],
      ["Errors found", nErr],
      ["Warnings", nWarn],
      ["Values typed over formulas", overwritten.length - 1],
      ["External workbook links", externalLinks.size],
      ["Volatile functions used", [...funcCount.keys()].filter((f) => VOLATILE.has(f)).join(", ") || "none"],
      [],
      ["Function", "Uses"],
      ...[...funcCount.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, n] as Row),
    ];
    const sheets: Sheet[] = [{ name: "Summary", rows: summary }, { name: "Per sheet", rows: sheetStats }, { name: "Issues", rows: issuesRows }];
    if (overwritten.length > 1) sheets.push({ name: "Typed over formulas", rows: overwritten });
    if (errorCells.length) sheets.push({ name: "Error cells", rows: [["Sheet", "Cell", "Error"], ...errorCells.map((e) => [e.sheet, e.addr, e.value] as Row)] });
    if (externalLinks.size) sheets.push({ name: "External links", rows: [["Workbook"], ...[...externalLinks].map((l) => [l] as Row)] });
    if (includeList) sheets.push({ name: "All formulas", rows: listRows });
    outputs.push(xlsxFile(`${baseName(files[fi].name)}-formula-audit.xlsx`, sheets));
    grandFormulas += cells.length;
    grandIssues += issuesRows.length - 1;
    reportLines.push(`${files[fi].name}: ${cells.length} formulas, ${nErr} errors, ${nWarn} warnings, ${overwritten.length - 1} typed-over cells, ${errorCells.length} error cells`);
    onProgress?.((fi + 1) / files.length);
  }
  if (files.length > 1) outputs.push(fileFromText("audit-summary.txt", reportLines.join("\n")));
  return { files: outputs, text: reportLines.join("\n"), stats: { Workbooks: String(files.length), Formulas: grandFormulas.toLocaleString(), Findings: grandIssues.toLocaleString() } };
};
