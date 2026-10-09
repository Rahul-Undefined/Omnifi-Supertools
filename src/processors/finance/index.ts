import type { CalcProcessor, FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName, withSuffix, formatNumber } from "@/lib/utils";
import { readSheets, xlsxFile, requireColumn, headerIndex, splitList, cellText, type Row, type Sheet } from "../shared/table";
import { parseDate, formatDate, type DateAssumption } from "../shared/dates";
import { parseAmount, round2, type DecimalStyle } from "../shared/amounts";
import { openPdf, closePdf, pageLines } from "../shared/pdfjs";
import { textOutput } from "../shared/output";
import * as calc from "./calculators";

const n = (v: unknown, d = 0) => { const x = Number(v); return isFinite(x) ? x : d; };
const money = (v: number) => formatNumber(round2(v), 2);
const pct = (v: number) => `${formatNumber(v, 2)}%`;

const lines = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");
const stats = (rows: [string, string][]) => Object.fromEntries(rows);
const table = (header: string[], rows: (string | number)[][]) => ({ header, rows });

/* ---------- Calculators ---------- */

export const gst: CalcProcessor = async ({ options }) => {
  const r = calc.gst(n(options.amount), n(options.rate), String(options.mode) === "inclusive");
  const rows: [string, string][] = [["Net amount", money(r.net)], ["GST", money(r.tax)], ["Gross amount", money(r.gross)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const percentage: CalcProcessor = async ({ options }) => {
  const x = n(options.x); const y = n(options.y); const mode = String(options.mode ?? "of");
  const r = calc.percentage(mode, x, y);
  const rows: [string, string][] = [[r.label, r.unit === "%" ? pct(r.value) : money(r.value)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const margin: CalcProcessor = async ({ options }) => {
  const r = calc.margin(n(options.cost), n(options.revenue));
  const rows: [string, string][] = [["Gross profit", money(r.profit)], ["Gross margin", pct(r.marginPct)], ["Markup", pct(r.markupPct)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const markup: CalcProcessor = async ({ options }) => {
  const r = calc.markup(n(options.cost), n(options.markup));
  const rows: [string, string][] = [["Selling price", money(r.price)], ["Profit", money(r.profit)], ["Margin", pct(r.marginPct)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const discount: CalcProcessor = async ({ options }) => {
  const r = calc.discount(n(options.price), n(options.discount));
  const rows: [string, string][] = [["Final price", money(r.final)], ["You save", money(r.saved)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const emi: CalcProcessor = async ({ options }) => {
  const r = calc.emi(n(options.principal), n(options.rate), n(options.months, 1));
  const rows: [string, string][] = [["Monthly EMI", money(r.emi)], ["Total interest", money(r.totalInterest)], ["Total payment", money(r.totalPayment)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const amortization: CalcProcessor = async ({ options }) => {
  const r = calc.amortization(n(options.principal), n(options.rate), n(options.months, 1));
  const header = ["Month", "Payment", "Principal", "Interest", "Balance"];
  const rows = r.schedule.map((s) => [s.month, round2(s.payment), round2(s.principal), round2(s.interest), round2(s.balance)]);
  const sheet: Sheet = { name: "Schedule", rows: [header, ...rows] };
  const summary: [string, string][] = [["Monthly payment", money(r.payment)], ["Total interest", money(r.totalInterest)], ["Total paid", money(r.totalPaid)]];
  return { files: [xlsxFile("amortization-schedule.xlsx", [sheet])], text: lines(summary), data: table(header, rows), stats: stats(summary) };
};

export const interest: CalcProcessor = async ({ options }) => {
  const r = calc.interest(n(options.principal), n(options.rate), n(options.years), n(options.compounding, 12));
  const rows: [string, string][] = [["Interest earned", money(r.interest)], ["Final amount", money(r.total)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const cagr: CalcProcessor = async ({ options }) => {
  const r = calc.cagr(n(options.start), n(options.end), n(options.years, 1));
  const rows: [string, string][] = [["CAGR", pct(r.cagrPct)], ["Total growth", pct(r.totalGrowthPct)]];
  return textOutput(lines(rows), r, stats(rows));
};

const parseFlows = (s: unknown): number[] => {
  const flows = String(s ?? "").split(/[\n,;]+/).map((x) => parseAmount(x)).filter((x): x is number => x != null);
  if (flows.length < 2) throw new ProcessorError("Enter at least two cash flows", "One per line, starting with the initial outlay as a negative number");
  return flows;
};

export const irr: CalcProcessor = async ({ options }) => {
  const flows = parseFlows(options.flows);
  const r = calc.irr(flows);
  if (r == null) throw new ProcessorError("IRR did not converge", "Check that flows change sign at least once");
  const rows: [string, string][] = [["IRR", pct(r * 100)], ["Periods", String(flows.length - 1)]];
  return textOutput(lines(rows), { irr: r, flows }, stats(rows));
};

export const npv: CalcProcessor = async ({ options }) => {
  const flows = parseFlows(options.flows);
  const r = calc.npv(n(options.rate), flows);
  const rows: [string, string][] = [["NPV", money(r)], ["Discount rate", pct(n(options.rate))], ["Verdict", r >= 0 ? "Value creating" : "Value destroying"]];
  return textOutput(lines(rows), { npv: r, flows }, stats(rows));
};

export const roi: CalcProcessor = async ({ options }) => {
  const r = calc.roi(n(options.cost), n(options.gain), n(options.years));
  const rows: [string, string][] = [["Net gain", money(r.gain)], ["ROI", pct(r.roiPct)]];
  if (r.annualizedPct != null) rows.push(["Annualised ROI", pct(r.annualizedPct)]);
  return textOutput(lines(rows), r, stats(rows));
};

export const breakEven: CalcProcessor = async ({ options }) => {
  const r = calc.breakEven(n(options.fixed), n(options.price), n(options.variable));
  if (!r) throw new ProcessorError("Price must exceed variable cost per unit");
  const rows: [string, string][] = [["Break-even units", formatNumber(Math.ceil(r.units), 0)], ["Break-even revenue", money(r.revenue)], ["Contribution per unit", money(r.contribution)]];
  return textOutput(lines(rows), r, stats(rows));
};

export const depreciationSL: CalcProcessor = async ({ options }) => {
  const r = calc.straightLine(n(options.cost), n(options.salvage), n(options.years, 1));
  const header = ["Year", "Depreciation", "Accumulated", "Book value"];
  const rows = r.map((s) => [s.year, round2(s.depreciation), round2(s.accumulated), round2(s.bookValue)]);
  const summary: [string, string][] = [["Annual depreciation", money(r[0]?.depreciation ?? 0)]];
  return { files: [xlsxFile("straight-line-depreciation.xlsx", [{ name: "Schedule", rows: [header, ...rows] }])], text: lines(summary), data: table(header, rows), stats: stats(summary) };
};

export const depreciationDB: CalcProcessor = async ({ options }) => {
  const r = calc.decliningBalance(n(options.cost), n(options.salvage), n(options.years, 1), n(options.factor, 2));
  const header = ["Year", "Depreciation", "Accumulated", "Book value"];
  const rows = r.map((s) => [s.year, round2(s.depreciation), round2(s.accumulated), round2(s.bookValue)]);
  const summary: [string, string][] = [["Year 1 depreciation", money(r[0]?.depreciation ?? 0)], ["Rate", pct((n(options.factor, 2) / n(options.years, 1)) * 100)]];
  return { files: [xlsxFile("declining-balance-depreciation.xlsx", [{ name: "Schedule", rows: [header, ...rows] }])], text: lines(summary), data: table(header, rows), stats: stats(summary) };
};

/* ---------- Accounting data tools ---------- */

async function eachSheetFile(
  files: File[],
  onProgress: ((f: number, l?: string) => void) | undefined,
  signal: AbortSignal | undefined,
  suffix: string,
  fn: (rows: Row[], sheetName: string) => Row[],
): Promise<ProcessorFile[]> {
  const out: ProcessorFile[] = [];
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = await readSheets(files[i]);
    const processed = sheets.map((s) => ({ name: s.name, rows: s.rows.length ? fn(s.rows, s.name) : s.rows }));
    out.push(xlsxFile(withSuffix(files[i].name, suffix, "xlsx"), processed));
    onProgress?.((i + 1) / files.length, files[i].name);
  }
  return out;
}

const cleanDescription = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\b(POS|DEBIT CARD PURCHASE|CARD PURCHASE|ACH|EFT|TFR|WITHDRAWAL|DEPOSIT|PURCHASE|PAYMENT TO|PMT)\b/gi, "")
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, "")
    .replace(/\b[A-Z0-9]{10,}\b/g, "")
    .replace(/[#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const transactionClean: FileProcessor = async (files, { options, onProgress, signal }) => {
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  let count = 0;
  let badDates = 0;
  const outputs = await eachSheetFile(files, onProgress, signal, "-clean", (rows) => {
    const di = headerIndex(rows, String(options.dateColumn ?? "Date"));
    const desci = headerIndex(rows, String(options.descColumn ?? "Description"));
    const ai = headerIndex(rows, String(options.amountColumn ?? "Amount"));
    const debi = headerIndex(rows, String(options.debitColumn ?? ""));
    const credi = headerIndex(rows, String(options.creditColumn ?? ""));
    if (di < 0 && desci < 0 && ai < 0 && debi < 0) throw new ProcessorError("None of the configured columns were found", `Headers present: ${rows[0].map(cellText).join(", ")}`);
    const header = ["Date", "Description", "Amount", "Debit", "Credit", "Type", "Original description"];
    const out: Row[] = [header];
    for (const r of rows.slice(1)) {
      const rawDesc = desci >= 0 ? cellText(r[desci]) : "";
      let amount: number | null = null;
      if (ai >= 0) amount = parseAmount(r[ai]);
      if (amount == null && (debi >= 0 || credi >= 0)) {
        const d = debi >= 0 ? parseAmount(r[debi]) : null;
        const c = credi >= 0 ? parseAmount(r[credi]) : null;
        if (d != null || c != null) amount = (c ?? 0) - (d ?? 0);
      }
      const d = di >= 0 ? parseDate(r[di], assume) : null;
      if (di >= 0 && !d && cellText(r[di]) !== "") badDates++;
      if (amount == null && !rawDesc && !d) continue;
      const debit = amount != null && amount < 0 ? round2(-amount) : null;
      const credit = amount != null && amount > 0 ? round2(amount) : null;
      out.push([d ? formatDate(d, "yyyy-mm-dd") : cellText(r[di] ?? ""), cleanDescription(rawDesc), amount != null ? round2(amount) : null, debit, credit, amount == null ? "" : amount < 0 ? "Debit" : "Credit", rawDesc]);
      count++;
    }
    return out;
  });
  return { files: outputs, stats: { Transactions: String(count), "Unparsed dates": String(badDates) }, warnings: badDates ? [`${badDates} rows had dates that could not be parsed; the original text was kept.`] : undefined };
};

export const duplicateTransactions: FileProcessor = async (files, { options, onProgress, signal }) => {
  const windowDays = Math.max(0, n(options.windowDays));
  let flagged = 0;
  const outputs = await eachSheetFile(files, onProgress, signal, "-duplicates", (rows) => {
    const di = requireColumn(rows, String(options.dateColumn ?? "Date"));
    const desci = headerIndex(rows, String(options.descColumn ?? "Description"));
    const ai = requireColumn(rows, String(options.amountColumn ?? "Amount"));
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const entries = rows.slice(1).map((r, i) => ({ i, r, d: parseDate(r[di]), amt: parseAmount(r[ai]), desc: norm(desci >= 0 ? cellText(r[desci]) : "") }));
    const groups = new Map<string, number[]>();
    for (const e of entries) {
      if (e.amt == null) continue;
      const key = `${e.amt.toFixed(2)}|${e.desc.slice(0, 24)}`;
      const g = groups.get(key) ?? [];
      g.push(e.i);
      groups.set(key, g);
    }
    const flag = new Map<number, string>();
    for (const [, idxs] of groups) {
      if (idxs.length < 2) continue;
      for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
        const ea = entries[idxs[a]]; const eb = entries[idxs[b]];
        const days = ea.d && eb.d ? Math.abs(ea.d.getTime() - eb.d.getTime()) / 86400000 : windowDays === 0 ? Infinity : 0;
        if (days <= windowDays) {
          flag.set(ea.i, `Row ${eb.i + 2}`);
          flag.set(eb.i, `Row ${ea.i + 2}`);
        }
      }
    }
    flagged += flag.size;
    return [[...rows[0], "Possible duplicate of"], ...rows.slice(1).map((r, i) => [...r, flag.get(i) ?? ""])];
  });
  return { files: outputs, stats: { "Rows flagged": String(flagged) } };
};

export const debitCredit: FileProcessor = async (files, { options, onProgress, signal }) => {
  const mode = String(options.mode ?? "split");
  const negativeIsDebit = String(options.negativeIs ?? "debit") === "debit";
  const outputs = await eachSheetFile(files, onProgress, signal, "-dc", (rows) => {
    if (mode === "split") {
      const ai = requireColumn(rows, String(options.amountColumn ?? "Amount"));
      return [[...rows[0], String(options.debitColumn ?? "Debit"), String(options.creditColumn ?? "Credit")], ...rows.slice(1).map((r) => {
        const a = parseAmount(r[ai]);
        if (a == null) return [...r, null, null];
        const isDebit = negativeIsDebit ? a < 0 : a > 0;
        return [...r, isDebit ? round2(Math.abs(a)) : null, isDebit ? null : round2(Math.abs(a))];
      })];
    }
    const di = requireColumn(rows, String(options.debitColumn ?? "Debit"));
    const ci = requireColumn(rows, String(options.creditColumn ?? "Credit"));
    return [[...rows[0], String(options.amountColumn ?? "Amount")], ...rows.slice(1).map((r) => {
      const d = parseAmount(r[di]) ?? 0; const c = parseAmount(r[ci]) ?? 0;
      return [...r, round2(negativeIsDebit ? c - d : d - c)];
    })];
  });
  return { files: outputs };
};

export const categorize: FileProcessor = async (files, { options, onProgress, signal }) => {
  const rules = String(options.rules ?? "").split(/\r?\n/).map((l) => l.split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => ({ k: k.trim().toLowerCase(), v: v.join("=").trim() })).filter((r) => r.k && r.v);
  if (!rules.length) throw new ProcessorError("Add at least one rule", "Format: keyword = Category");
  const fallback = String(options.fallback ?? "Uncategorised");
  let matched = 0; let total = 0;
  const outputs = await eachSheetFile(files, onProgress, signal, "-categorised", (rows) => {
    const desci = requireColumn(rows, String(options.descColumn ?? "Description"));
    return [[...rows[0], "Category"], ...rows.slice(1).map((r) => {
      const d = cellText(r[desci]).toLowerCase();
      const hit = rules.find((x) => d.includes(x.k));
      total++; if (hit) matched++;
      return [...r, hit ? hit.v : fallback];
    })];
  });
  return { files: outputs, stats: { Categorised: `${matched} / ${total}` } };
};

export const accountMap: FileProcessor = async (files, { options, onProgress, signal }) => {
  const map = new Map<string, { no: string; name: string }>();
  for (const line of String(options.mapping ?? "").split(/\r?\n/)) {
    const [k, rest] = line.split("=");
    if (!k || !rest) continue;
    const [no, name] = rest.split("|").map((s) => s.trim());
    map.set(k.trim().toLowerCase(), { no: no ?? "", name: name ?? "" });
  }
  if (!map.size) throw new ProcessorError("Add at least one mapping", "Format: Category = 6100 | Office Expenses");
  let unmapped = 0;
  const outputs = await eachSheetFile(files, onProgress, signal, "-mapped", (rows) => {
    const ci = requireColumn(rows, String(options.column ?? "Category"));
    return [[...rows[0], "Account No", "Account Name"], ...rows.slice(1).map((r) => {
      const m = map.get(cellText(r[ci]).toLowerCase());
      if (!m) unmapped++;
      return [...r, m?.no ?? "", m?.name ?? ""];
    })];
  });
  return { files: outputs, stats: { Unmapped: String(unmapped) } };
};

export const normalizeAmounts: FileProcessor = async (files, { options, onProgress, signal }) => {
  const cols = splitList(String(options.columns ?? "Amount"));
  const style = String(options.locale ?? "auto") as DecimalStyle;
  let converted = 0;
  const outputs = await eachSheetFile(files, onProgress, signal, "-amounts", (rows) => {
    const idx = cols.map((c) => headerIndex(rows, c)).filter((i) => i >= 0);
    if (!idx.length) throw new ProcessorError("None of the amount columns were found");
    return rows.map((r, ri) => {
      if (ri === 0) return r;
      const copy = [...r];
      for (const i of idx) { const v = parseAmount(copy[i], style); if (v != null) { copy[i] = round2(v); converted++; } }
      return copy;
    });
  });
  return { files: outputs, stats: { "Values normalised": String(converted) } };
};

/** Heuristic: a transaction line has a leading date and a trailing amount. */
export const statementPdfToExcel: FileProcessor = async (files, { options, onProgress, signal }) => {
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  const outputs: ProcessorFile[] = [];
  let total = 0;
  for (let fi = 0; fi < files.length; fi++) {
    const doc = await openPdf(files[fi]);
    const rows: Row[] = [["Date", "Description", "Amount", "Balance", "Page"]];
    for (let p = 1; p <= doc.numPages; p++) {
      throwIfAborted(signal);
      for (const line of await pageLines(doc, p)) {
        const cells = line.map((i) => i.str.trim()).filter(Boolean);
        if (cells.length < 2) continue;
        const d = parseDate(cells[0], assume);
        if (!d) continue;
        const amounts = cells.slice(1).map((c) => parseAmount(c)).map((v, i) => ({ v, i: i + 1 })).filter((x) => x.v != null && /\d/.test(cells[x.i]) && /[\d.,]+$/.test(cells[x.i]));
        if (!amounts.length) continue;
        const last = amounts[amounts.length - 1];
        const amt = amounts.length >= 2 ? amounts[amounts.length - 2] : last;
        const balance = amounts.length >= 2 ? last.v : null;
        const desc = cells.slice(1, amt.i).join(" ");
        rows.push([formatDate(d, "yyyy-mm-dd"), desc, amt.v, balance, p]);
      }
      onProgress?.((fi + p / doc.numPages) / files.length);
    }
    await closePdf(doc);
    total += rows.length - 1;
    outputs.push(xlsxFile(`${baseName(files[fi].name)}-transactions.xlsx`, [{ name: "Transactions", rows }]));
  }
  if (!total) throw new ProcessorError("No transaction lines detected", "The statement may be scanned (run OCR first) or laid out in an unusual way.");
  return { files: outputs, stats: { Transactions: String(total) }, warnings: ["Extraction is heuristic. Reconcile totals before use."] };
};
