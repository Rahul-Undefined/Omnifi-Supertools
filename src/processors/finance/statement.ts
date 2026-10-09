import type { FileProcessor, ProcessorFile } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { withSuffix } from "@/lib/utils";
import { readSheets, xlsxFile, requireColumn, cellText, type Row, type Sheet } from "../shared/table";
import { parseDate, type DateAssumption } from "../shared/dates";
import { parseAmount, round2 } from "../shared/amounts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const statementSplit: FileProcessor = async (files, { options, onProgress, signal }) => {
  const by = String(options.by ?? "month");
  const assume = String(options.assume ?? "mdy") as DateAssumption;
  const addTotals = options.totals !== false;
  const outputs: ProcessorFile[] = [];
  let groupsTotal = 0;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    const sheets = await readSheets(files[i]);
    const src = sheets.find((s) => s.rows.length > 1);
    if (!src) throw new ProcessorError(`${files[i].name} has no data rows`);
    const header = src.rows[0];
    const keyIdx = by === "column" ? requireColumn(src.rows, String(options.groupColumn ?? "Account")) : requireColumn(src.rows, String(options.dateColumn ?? "Date"));
    const amountIdx = header.findIndex((h) => /^(amount|total|debit|credit)$/i.test(cellText(h)));
    const groups = new Map<string, Row[]>();
    let skipped = 0;
    for (const r of src.rows.slice(1)) {
      let key: string;
      if (by === "column") key = cellText(r[keyIdx]).trim() || "(blank)";
      else {
        const d = parseDate(r[keyIdx], assume);
        if (!d) { skipped++; continue; }
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        key = by === "year" ? String(y) : by === "quarter" ? `${y} Q${Math.floor(m / 3) + 1}` : `${y}-${String(m + 1).padStart(2, "0")} ${MONTHS[m]}`;
      }
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    if (!groups.size) throw new ProcessorError("No rows could be grouped", by === "column" ? "Check the column name." : "No parseable dates were found in the date column.");
    const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const summary: Row[] = [["Group", "Rows", amountIdx >= 0 ? "Total" : ""]];
    const out: Sheet[] = ordered.map(([name, rows]) => {
      const total = amountIdx >= 0 ? round2(rows.reduce((a, r) => a + (parseAmount(r[amountIdx]) ?? 0), 0)) : null;
      summary.push([name, rows.length, total ?? ""]);
      const body: Row[] = [header, ...rows];
      if (addTotals && amountIdx >= 0) {
        const totalRow: Row = header.map(() => null);
        totalRow[0] = "TOTAL";
        totalRow[amountIdx] = total;
        body.push(totalRow);
      }
      return { name: name.slice(0, 31), rows: body };
    });
    groupsTotal += out.length;
    outputs.push(xlsxFile(withSuffix(files[i].name, `-by-${by}`, "xlsx"), [{ name: "Summary", rows: summary }, ...out]));
    onProgress?.((i + 1) / files.length, files[i].name);
    if (skipped) (outputs[outputs.length - 1] as ProcessorFile & { skipped?: number }).skipped = skipped;
  }
  const skipped = outputs.reduce((a, f) => a + ((f as ProcessorFile & { skipped?: number }).skipped ?? 0), 0);
  return { files: outputs, stats: { Groups: String(groupsTotal), Files: String(outputs.length) }, warnings: skipped ? [`${skipped} rows without a readable date were left out.`] : undefined };
};
