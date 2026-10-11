import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName } from "@/lib/utils";
import { xlsxFile, type Row, type Sheet } from "../shared/table";
import { parseDate, formatDate, type DateAssumption } from "../shared/dates";
import { parseAmount } from "../shared/amounts";
import { openPdf, closePdf, renderPage, pageText, pageLines } from "../shared/pdfjs";
import { canvasToBlob } from "../shared/canvas";
import { fileFromText } from "../shared/output";
import { zipFiles } from "../shared/zip";

const PDF = "application/pdf";
const AMOUNT_RE = /^[-+(]?\$?\(?-?[\d,]*\.?\d{1,2}\)?(?:\s?(?:CR|DR|Cr|Dr))?$/;

/**
 * Turn the cells of one statement line into a transaction, or null.
 * Shared rule with "Bank statement to Excel": first cell is a date, the last
 * one or two numeric cells are amount and running balance.
 */
export function lineToTransaction(cells: string[], assume: DateAssumption): { date: string; desc: string; amount: number; balance: number | null } | null {
  if (cells.length < 2) return null;
  let d = parseDate(cells[0], assume);
  let descStart = 1;
  if (!d && cells.length > 2) { d = parseDate(`${cells[0]} ${cells[1]}`, assume); if (d) descStart = 2; }
  if (!d) return null;
  const amounts = cells.slice(descStart).map((c, i) => ({ v: parseAmount(c), i: i + descStart, raw: c })).filter((x) => x.v != null && /\d/.test(x.raw) && AMOUNT_RE.test(x.raw.replace(/\s+/g, "")));
  if (!amounts.length) return null;
  const last = amounts[amounts.length - 1];
  const amt = amounts.length >= 2 ? amounts[amounts.length - 2] : last;
  const balance = amounts.length >= 2 ? last.v : null;
  const desc = cells.slice(descStart, amt.i).join(" ").trim();
  if (!desc) return null;
  return { date: formatDate(d, "yyyy-mm-dd"), desc, amount: amt.v!, balance };
}

/** Split an OCR text line into cells: runs of 2+ spaces first, then by single spaces with trailing-amount detection. */
export function ocrLineToCells(line: string): string[] {
  const wide = line.trim().split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  if (wide.length >= 3) return wide;
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 3) return toks;
  // Peel trailing amounts.
  const tail: string[] = [];
  while (toks.length > 1 && tail.length < 3 && AMOUNT_RE.test(toks[toks.length - 1].replace(/\s+/g, "")) && /\d/.test(toks[toks.length - 1])) tail.unshift(toks.pop()!);
  const first = toks.shift()!;
  // Dates like "Jan 5", "5 Jan" or "Jan 5, 2026" take two or three tokens.
  const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?$/i;
  const DAY = /^\d{1,2},?$/;
  if (toks.length && ((MONTH.test(first) && DAY.test(toks[0])) || (DAY.test(first) && MONTH.test(toks[0])))) {
    let date = `${first} ${toks.shift()}`;
    if (toks.length && /^(?:19|20)\d{2}$/.test(toks[0])) date += ` ${toks.shift()}`;
    return [date, toks.join(" "), ...tail].filter(Boolean);
  }
  return [first, toks.join(" "), ...tail].filter(Boolean);
}

export const batchOcrStatements: FileProcessor = async (files, { options, onProgress, signal }) => {
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  const lang = String(options.lang ?? "eng");
  const forceOcr = Boolean(options.forceOcr);
  const keepText = options.keepText !== false;
  const scale = 2;

  let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
  const getWorker = async () => {
    if (worker) return worker;
    const { createWorker } = await import("tesseract.js");
    onProgress?.(0.02, "Loading OCR engine");
    worker = await createWorker(lang, 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract", langPath: "/tessdata" });
    return worker;
  };

  const all: Row[] = [["Source file", "Date", "Description", "Amount", "Balance", "Page", "Method"]];
  const perFile: Sheet[] = [];
  const texts: ProcessorFile[] = [];
  const summary: Row[] = [["File", "Pages", "Method", "Transactions", "Total of amounts", "Notes"]];
  let total = 0;
  try {
    for (let fi = 0; fi < files.length; fi++) {
      throwIfAborted(signal);
      const file = files[fi];
      const isPdf = file.type === PDF || file.name.toLowerCase().endsWith(".pdf");
      const rows: Row[] = [["Date", "Description", "Amount", "Balance", "Page"]];
      let method = "text layer";
      let pages = 1;
      let note = "";
      let ocrText = "";
      const base = fi / files.length;
      const span = 1 / files.length;
      const push = (t: NonNullable<ReturnType<typeof lineToTransaction>>, page: number) => {
        rows.push([t.date, t.desc, t.amount, t.balance, page]);
        all.push([file.name, t.date, t.desc, t.amount, t.balance, page, method]);
      };

      if (isPdf) {
        const doc = await openPdf(file);
        pages = doc.numPages;
        let textChars = 0;
        if (!forceOcr) for (let p = 1; p <= Math.min(pages, 3); p++) textChars += (await pageText(doc, p)).replace(/\s/g, "").length;
        const hasText = !forceOcr && textChars > 80 * Math.min(pages, 3);
        if (hasText) {
          for (let p = 1; p <= pages; p++) {
            throwIfAborted(signal);
            for (const line of await pageLines(doc, p)) {
              const t = lineToTransaction(line.map((i) => i.str.trim()).filter(Boolean), assume);
              if (t) push(t, p);
            }
            onProgress?.(base + span * (p / pages), `${file.name} · page ${p}`);
          }
        } else {
          method = "OCR";
          const w = await getWorker();
          for (let p = 1; p <= pages; p++) {
            throwIfAborted(signal);
            const img = await canvasToBlob(await renderPage(doc, p, scale), "image/png");
            const { data } = await w.recognize(img);
            ocrText += (pages > 1 ? `--- page ${p} ---\n` : "") + data.text + "\n";
            for (const raw of data.text.split(/\r?\n/)) {
              const t = lineToTransaction(ocrLineToCells(raw), assume);
              if (t) push(t, p);
            }
            onProgress?.(base + span * (p / pages), `${file.name} · OCR page ${p}`);
          }
        }
        await closePdf(doc);
      } else {
        method = "OCR";
        const w = await getWorker();
        const { data } = await w.recognize(file);
        ocrText = data.text;
        for (const raw of data.text.split(/\r?\n/)) {
          const t = lineToTransaction(ocrLineToCells(raw), assume);
          if (t) push(t, 1);
        }
        onProgress?.(base + span, file.name);
      }
      const n = rows.length - 1;
      total += n;
      if (!n) note = method === "OCR" ? "No transaction lines recognised; check scan quality or date format" : "No transaction lines found in the text layer";
      const sum = rows.slice(1).reduce((s, r) => s + Number(r[2] ?? 0), 0);
      summary.push([file.name, pages, method, n, Math.round(sum * 100) / 100, note]);
      perFile.push({ name: baseName(file.name).slice(0, 31) || `File ${fi + 1}`, rows });
      if (keepText && ocrText.trim()) texts.push(fileFromText(`${baseName(file.name)}-ocr.txt`, ocrText.trim()));
    }
  } finally {
    if (worker) await (worker as { terminate(): Promise<unknown> }).terminate();
  }
  if (!total) throw new ProcessorError("No transactions detected in any file", "Try the other date order, tick 'Force OCR' for scanned PDFs, or run OCR PDF first to inspect the text.");
  const workbook = xlsxFile("statements-extracted.xlsx", [{ name: "All transactions", rows: all }, { name: "Summary", rows: summary }, ...perFile]);
  const outputs: ProcessorFile[] = [workbook];
  if (texts.length) outputs.push(texts.length === 1 ? texts[0] : await zipFiles(texts, "ocr-text.zip"));
  const ocrCount = summary.slice(1).filter((r) => r[2] === "OCR").length;
  return {
    files: outputs,
    stats: { Files: String(files.length), Transactions: total.toLocaleString(), "OCR used on": `${ocrCount} file(s)` },
    warnings: ["Extraction is heuristic, and OCR can misread digits. Reconcile totals before posting anything."],
    data: { header: ["File", "Pages", "Method", "Transactions", "Total", "Notes"], rows: summary.slice(1).map((r) => r.map((c) => (c == null ? "" : (c as string | number)))) },
  };
};
