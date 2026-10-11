import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { consolidate, formulaAudit } from "../src/processors/office/advanced";
import { readSheets } from "../src/processors/shared/table";

function workbook(name: string, sheets: Record<string, unknown[][]>, formulas: Record<string, Record<string, string>> = {}): File {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    for (const [addr, f] of Object.entries(formulas[n] ?? {})) ws[addr] = { ...(ws[addr] ?? { t: "n", v: 0 }), f };
    XLSX.utils.book_append_sheet(wb, ws, n);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const ctx = (options: Record<string, string | number | boolean>) => ({ options });

describe("multi-file consolidator", () => {
  const jan = workbook("jan.xlsx", { Data: [["Date", "Vendor", "Amount"], ["2026-01-02", "Acme", 100], ["2026-01-05", "Globex", 50]] });
  const feb = workbook("feb.xlsx", { Data: [["Vendor", "Amount", "Date", "Memo"], ["Acme", 75, "2026-02-01", "late"]] });

  it("stacks rows matching headers by name and reports header gaps", async () => {
    const out = await consolidate([jan, feb], ctx({ mode: "stack" }));
    const sheets = await readSheets(new File([out.files[0].blob], out.files[0].name));
    const main = sheets.find((s) => s.name === "Consolidated")!;
    expect(main.rows[0]).toEqual(["Source file", "Source sheet", "Date", "Vendor", "Amount", "Memo"]);
    expect(main.rows).toHaveLength(4);
    expect(main.rows[3]).toEqual(["feb.xlsx", "Data", "2026-02-01", "Acme", 75, "late"]);
    expect(main.rows[1][5]).toBeNull();
    expect(sheets.find((s) => s.name === "Header gaps")!.rows[1]).toEqual(["Memo", "jan.xlsx / Data"]);
    expect(out.stats?.Rows).toBe("3");
  });

  it("keeps one sheet per file", async () => {
    const out = await consolidate([jan, feb], ctx({ mode: "sheets", addSource: false }));
    const sheets = await readSheets(new File([out.files[0].blob], out.files[0].name));
    expect(sheets.map((s) => s.name)).toEqual(["jan", "feb", "Sources"]);
  });
});

describe("formula audit", () => {
  it("finds errors, inconsistent formulas and typed-over values", async () => {
    const rows: unknown[][] = [["Qty", "Price", "Total"]];
    for (let r = 2; r <= 9; r++) rows.push([r, 10, r * 10]);
    rows.push(["Lookup", "", 10]);
    rows.push(["Now", "", 0]);
    const formulas: Record<string, string> = { C2: "A2*B2", C3: "A3*B3", C4: "A4*B4", C5: "A5*B5*1.5", C6: "A6*B6", C7: "A7*B7", C9: "A9*B9", C10: "VLOOKUP(A2,Prices!A1:B9,2)", C11: "NOW()" }; // C8 typed over
    const wb = workbook("model.xlsx", { Calc: rows, Prices: [["Qty", "Price"], [1, 10]] }, { Calc: formulas });
    const out = await formulaAudit([wb], ctx({ includeList: true }));
    const sheets = await readSheets(new File([out.files[0].blob], out.files[0].name));
    const names = sheets.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Summary", "Per sheet", "Issues", "Typed over formulas", "All formulas"]));
    const issues = sheets.find((s) => s.name === "Issues")!.rows.slice(1).map((r) => `${r[1]}: ${r[3]}`);
    expect(issues).toContain("C5: Formula differs from the cells around it");
    expect(issues.some((i) => i.startsWith("C10: VLOOKUP without the 4th argument"))).toBe(true);
    expect(issues.some((i) => i.startsWith("C11: NOW is volatile"))).toBe(true);
    const typed = sheets.find((s) => s.name === "Typed over formulas")!.rows;
    expect(typed[1].slice(0, 3)).toEqual(["Calc", "C8", 80]);
    expect(out.stats?.Formulas).toBe("9");
  });
});
