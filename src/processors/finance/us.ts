import type { CalcProcessor, FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { formatNumber, withSuffix } from "@/lib/utils";
import { readSheets, xlsxFile, requireColumn, headerIndex, cellText, type Row } from "../shared/table";
import { parseDate, formatDate, type DateAssumption } from "../shared/dates";
import { parseAmount, round2 } from "../shared/amounts";
import { textOutput } from "../shared/output";

const n = (v: unknown, d = 0) => { const x = Number(v); return isFinite(x) ? x : d; };
const money = (v: number) => formatNumber(round2(v), 2);
const pct = (v: number) => `${formatNumber(v, 2)}%`;
const lines = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");
const stats = (rows: [string, string][]) => Object.fromEntries(rows);

/* ---------------- US calculators ---------------- */

export const salesTax: CalcProcessor = async ({ options }) => {
  const amount = n(options.amount);
  const rate = n(options.rate);
  const inclusive = String(options.mode ?? "exclusive") === "inclusive";
  const net = inclusive ? amount / (1 + rate / 100) : amount;
  const tax = inclusive ? amount - net : amount * (rate / 100);
  const rows: [string, string][] = [["Subtotal", money(net)], [`Sales tax (${pct(rate)})`, money(tax)], ["Total", money(net + tax)]];
  return textOutput(lines(rows), { net, tax, total: net + tax }, stats(rows));
};

export const loanPayment: CalcProcessor = async ({ options }) => {
  const principal = n(options.principal);
  const rate = n(options.rate) / 100 / 12;
  const months = Math.max(1, n(options.years, 30) * 12);
  const payment = rate === 0 ? principal / months : (principal * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
  const total = payment * months;
  const extras = n(options.taxes) + n(options.insurance);
  const rows: [string, string][] = [["Principal & interest", money(payment)], ["Total monthly (with taxes/insurance)", money(payment + extras)], ["Total interest", money(total - principal)], ["Total paid", money(total)]];
  return textOutput(lines(rows), { payment, total }, stats(rows));
};

export const mileage: CalcProcessor = async ({ options }) => {
  const miles = n(options.miles);
  const rate = n(options.rate, 0.7);
  const rows: [string, string][] = [["Miles", formatNumber(miles, 1)], ["Rate per mile", `$${formatNumber(rate, 3)}`], ["Reimbursement", `$${money(miles * rate)}`]];
  return textOutput(lines(rows), { miles, rate, total: miles * rate }, stats(rows));
};

export const paymentTerms: CalcProcessor = async ({ options }) => {
  const amount = n(options.amount);
  const discountPct = n(options.discount);
  const discountDays = n(options.discountDays, 10);
  const netDays = n(options.netDays, 30);
  const invoiceDate = parseDate(String(options.invoiceDate || ""), "mdy") ?? new Date();
  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
  const discounted = amount * (1 - discountPct / 100);
  // Annualised cost of skipping the discount: discount / (1 - discount) * 365 / (net - discount days)
  const annualized = discountPct > 0 && netDays > discountDays ? (discountPct / (100 - discountPct)) * (365 / (netDays - discountDays)) * 100 : 0;
  const rows: [string, string][] = [
    ["Pay by (discount)", `${formatDate(addDays(invoiceDate, discountDays), "mm/dd/yyyy")} → $${money(discounted)}`],
    ["Pay by (net)", `${formatDate(addDays(invoiceDate, netDays), "mm/dd/yyyy")} → $${money(amount)}`],
    ["Savings if paid early", `$${money(amount - discounted)}`],
    ["Annualised cost of skipping the discount", pct(annualized)],
  ];
  const verdict = annualized > 8 ? "Take the discount: skipping it costs more than typical borrowing." : annualized > 0 ? "Marginal: compare with your cost of funds." : "No early-pay discount offered.";
  return textOutput(`${lines(rows)}\n\n${verdict}`, { discounted, annualized }, stats(rows));
};

export const prorate: CalcProcessor = async ({ options }) => {
  const amount = n(options.amount);
  const start = parseDate(String(options.start || ""), "mdy");
  const end = parseDate(String(options.end || ""), "mdy");
  if (!start || !end) throw new ProcessorError("Enter a start and end date (mm/dd/yyyy)");
  const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const daysInMonth = periodEnd.getUTCDate();
  const used = Math.max(0, Math.round((Math.min(end.getTime(), periodEnd.getTime()) - Math.max(start.getTime(), periodStart.getTime())) / 86400000) + 1);
  const prorated = (amount / daysInMonth) * used;
  const rows: [string, string][] = [["Days in month", String(daysInMonth)], ["Days covered", String(used)], ["Daily rate", `$${money(amount / daysInMonth)}`], ["Prorated amount", `$${money(prorated)}`]];
  return textOutput(lines(rows), { prorated }, stats(rows));
};

export const businessDays: CalcProcessor = async ({ options }) => {
  const start = parseDate(String(options.start || ""), "mdy");
  if (!start) throw new ProcessorError("Enter a start date (mm/dd/yyyy)");
  const endInput = String(options.end || "").trim();
  const holidays = new Set(String(options.holidays ?? "").split(/[\n,;]+/).map((s) => parseDate(s.trim(), "mdy")).filter((d): d is Date => Boolean(d)).map((d) => d.toISOString().slice(0, 10)));
  const isBiz = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.has(d.toISOString().slice(0, 10));
  if (endInput) {
    const end = parseDate(endInput, "mdy");
    if (!end) throw new ProcessorError("Could not read the end date");
    let count = 0;
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) if (isBiz(d)) count++;
    const cal = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const rows: [string, string][] = [["Calendar days", String(cal)], ["Business days", String(count)], ["Weekends/holidays", String(cal - count)]];
    return textOutput(lines(rows), { count }, stats(rows));
  }
  const add = n(options.add, 10);
  let d = new Date(start);
  let remaining = add;
  while (remaining > 0) { d = new Date(d.getTime() + 86400000); if (isBiz(d)) remaining--; }
  const rows: [string, string][] = [["Start", formatDate(start, "mm/dd/yyyy")], [`+${add} business days`, formatDate(d, "mm/dd/yyyy")]];
  return textOutput(lines(rows), { date: d.toISOString() }, stats(rows));
};

export const allocate: CalcProcessor = async ({ options }) => {
  const amount = n(options.amount);
  const entries = String(options.splits ?? "").split(/\r?\n/).map((l) => l.split(/[=:]/)).filter((p) => p.length >= 2).map(([k, v]) => ({ name: k.trim(), weight: parseAmount(v) ?? 0 }));
  if (!entries.length) throw new ProcessorError("Add at least one line like Marketing = 40");
  const total = entries.reduce((a, e) => a + e.weight, 0);
  if (total <= 0) throw new ProcessorError("Weights must add up to more than zero");
  // Largest-remainder rounding so the cents always sum to the original amount.
  const cents = Math.round(amount * 100);
  const raw = entries.map((e) => (cents * e.weight) / total);
  const floors = raw.map((r) => Math.floor(r));
  let left = cents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const o of order) { if (left <= 0) break; floors[o.i]++; left--; }
  const rows = entries.map((e, i) => [e.name, formatNumber((e.weight / total) * 100, 2) + "%", money(floors[i] / 100)]);
  const text = rows.map((r) => `${r[0].padEnd(24)} ${r[1].padStart(8)}  $${r[2]}`).join("\n");
  return { files: [], text, data: { header: ["Line", "Share", "Amount ($)"], rows }, stats: { Total: `$${money(amount)}`, Lines: String(entries.length) } };
};

/* ---------------- Accounting data tools ---------------- */

export const arAging: FileProcessor = async (files, { options, onProgress, signal }) => {
  const asOf = parseDate(String(options.asOf || ""), "mdy") ?? new Date();
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  const outputs: ProcessorFile[] = [];
  const totals = { current: 0, b30: 0, b60: 0, b90: 0, over: 0 };
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = await readSheets(files[i]);
    const detail: Row[] = [];
    const byCustomer = new Map<string, number[]>();
    for (const s of sheets) {
      if (!s.rows.length) continue;
      const di = headerIndex(s.rows, String(options.dueColumn ?? "Due Date"));
      const invi = di >= 0 ? di : requireColumn(s.rows, String(options.invoiceDateColumn ?? "Invoice Date"));
      const ai = requireColumn(s.rows, String(options.amountColumn ?? "Amount"));
      const ci = headerIndex(s.rows, String(options.customerColumn ?? "Customer"));
      const terms = n(options.terms, 30);
      if (!detail.length) detail.push(["Customer", "Invoice/Due date", "Amount", "Days past due", "Bucket"]);
      for (const r of s.rows.slice(1)) {
        const base = parseDate(r[invi], assume);
        const amt = parseAmount(r[ai]);
        if (!base || amt == null) continue;
        const due = di >= 0 ? base : new Date(base.getTime() + terms * 86400000);
        const days = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
        const bucket = days <= 0 ? "Current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
        const key = bucket === "Current" ? "current" : bucket === "1-30" ? "b30" : bucket === "31-60" ? "b60" : bucket === "61-90" ? "b90" : "over";
        totals[key] += amt;
        const cust = ci >= 0 ? cellText(r[ci]) : "(all)";
        const agg = byCustomer.get(cust) ?? [0, 0, 0, 0, 0];
        agg[["current", "b30", "b60", "b90", "over"].indexOf(key)] += amt;
        byCustomer.set(cust, agg);
        detail.push([cust, formatDate(due, "mm/dd/yyyy"), round2(amt), Math.max(0, days), bucket]);
      }
    }
    if (detail.length <= 1) throw new ProcessorError("No invoice rows found", "Check the column names in the options.");
    const summary: Row[] = [["Customer", "Current", "1-30", "31-60", "61-90", "90+", "Total"], ...[...byCustomer.entries()].map(([c, a]) => [c, ...a.map(round2), round2(a.reduce((x, y) => x + y, 0))])];
    summary.push(["TOTAL", round2(totals.current), round2(totals.b30), round2(totals.b60), round2(totals.b90), round2(totals.over), round2(Object.values(totals).reduce((a, b) => a + b, 0))]);
    outputs.push(xlsxFile(withSuffix(files[i].name, "-aging", "xlsx"), [{ name: "Summary", rows: summary }, { name: "Detail", rows: detail }]));
    onProgress?.((i + 1) / files.length);
  }
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  return { files: outputs, stats: { "As of": formatDate(asOf, "mm/dd/yyyy"), Total: `$${money(all)}`, "Over 90": `$${money(totals.over)}`, "Past due": `$${money(all - totals.current)}` } };
};

export const bankReconciliation: FileProcessor = async (files, { options }) => {
  if (files.length !== 2) throw new ProcessorError("Upload two files: the bank export first, then the ledger/QuickBooks export");
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  const windowDays = n(options.windowDays, 3);
  const load = async (f: File, dateCol: string, amtCol: string, descCol: string) => {
    const s = (await readSheets(f))[0];
    if (!s?.rows.length) throw new ProcessorError(`${f.name} is empty`);
    const di = requireColumn(s.rows, dateCol);
    const ai = requireColumn(s.rows, amtCol);
    const desci = headerIndex(s.rows, descCol);
    return s.rows.slice(1).map((r, i) => ({ i, date: parseDate(r[di], assume), amt: parseAmount(r[ai]), desc: desci >= 0 ? cellText(r[desci]) : "", row: r })).filter((x) => x.date && x.amt != null) as { i: number; date: Date; amt: number; desc: string; row: Row }[];
  };
  const bank = await load(files[0], String(options.bankDate ?? "Date"), String(options.bankAmount ?? "Amount"), String(options.bankDesc ?? "Description"));
  const ledger = await load(files[1], String(options.ledgerDate ?? "Date"), String(options.ledgerAmount ?? "Amount"), String(options.ledgerDesc ?? "Description"));
  const usedLedger = new Set<number>();
  const matched: Row[] = [["Bank date", "Bank description", "Amount", "Ledger date", "Ledger description", "Day difference"]];
  const unmatchedBank: Row[] = [["Date", "Description", "Amount"]];
  for (const b of bank) {
    const cand = ledger
      .filter((l) => !usedLedger.has(l.i) && Math.abs(l.amt - b.amt) < 0.005 && Math.abs(l.date.getTime() - b.date.getTime()) / 86400000 <= windowDays)
      .sort((x, y) => Math.abs(x.date.getTime() - b.date.getTime()) - Math.abs(y.date.getTime() - b.date.getTime()))[0];
    if (cand) {
      usedLedger.add(cand.i);
      matched.push([formatDate(b.date, "mm/dd/yyyy"), b.desc, round2(b.amt), formatDate(cand.date, "mm/dd/yyyy"), cand.desc, Math.round((cand.date.getTime() - b.date.getTime()) / 86400000)]);
    } else unmatchedBank.push([formatDate(b.date, "mm/dd/yyyy"), b.desc, round2(b.amt)]);
  }
  const unmatchedLedger: Row[] = [["Date", "Description", "Amount"], ...ledger.filter((l) => !usedLedger.has(l.i)).map((l) => [formatDate(l.date, "mm/dd/yyyy"), l.desc, round2(l.amt)])];
  const sum = (rows: Row[]) => rows.slice(1).reduce((a, r) => a + Number(r[2] ?? 0), 0);
  const out = xlsxFile("reconciliation.xlsx", [{ name: "Matched", rows: matched }, { name: "In bank only", rows: unmatchedBank }, { name: "In ledger only", rows: unmatchedLedger }]);
  return {
    files: [out],
    stats: { Matched: String(matched.length - 1), "Bank only": `${unmatchedBank.length - 1} ($${money(sum(unmatchedBank))})`, "Ledger only": `${unmatchedLedger.length - 1} ($${money(sum(unmatchedLedger))})` },
    warnings: ["Matches are by exact amount within the day window; review the unmatched tabs for timing differences and fees."],
  };
};
