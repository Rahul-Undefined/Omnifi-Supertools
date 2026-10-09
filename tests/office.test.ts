import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readSheets, writeWorkbook } from "@/processors/shared/table";
import { csvToExcel, excelToCsv, dedupe, clean, splitColumn, mergeColumns, mergeSheets, compare, formatDates } from "@/processors/office";
import { transactionClean, duplicateTransactions, debitCredit, categorize, normalizeAmounts } from "@/processors/finance";

const csv = (text: string, name = "data.csv") => new File([text], name, { type: "text/csv" });
const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

async function rowsOf(blob: Blob, sheet = 0) {
  const wb = XLSX.read(await blob.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[wb.SheetNames[sheet]], { header: 1, defval: null });
}

describe("spreadsheet processors", () => {
  it("round-trips CSV -> XLSX -> CSV", async () => {
    const out = await csvToExcel([csv("Name,Amount\nAlice,10\nBob,20.5")], ctx());
    expect(out.files[0].name).toBe("data.xlsx");
    const rows = await rowsOf(out.files[0].blob);
    expect(rows).toEqual([["Name", "Amount"], ["Alice", 10], ["Bob", 20.5]]);
    const back = await excelToCsv([new File([out.files[0].blob], "data.xlsx")], ctx());
    expect(await back.files[0].blob.text()).toContain("Alice,10");
  });

  it("dedupes on chosen columns, case-insensitively", async () => {
    const out = await dedupe([csv("Email,Note\nA@x.com,1\na@x.com,2\nb@x.com,3")], ctx({ columns: "Email", caseInsensitive: true }));
    expect(out.stats?.["Duplicates removed"]).toBe("1");
    expect((await rowsOf(out.files[0].blob)).length).toBe(3);
  });

  it("cleans whitespace, empty rows/cols and headers", async () => {
    const out = await clean([csv("  Name ,,Amount\n Al  ice ,,1\n,,\n")], ctx({ snakeHeaders: true }));
    const rows = await rowsOf(out.files[0].blob);
    expect(rows[0]).toEqual(["name", "amount"]);
    expect(rows[1]).toEqual(["Al ice", 1]);
    expect(rows).toHaveLength(2);
  });

  it("splits and merges columns", async () => {
    const s = await splitColumn([csv("Full Name,Age\nAda Lovelace,36\nAlan,41")], ctx({ column: "Full Name", delimiter: " " }));
    const rows = await rowsOf(s.files[0].blob);
    expect(rows[0]).toEqual(["Full Name", "Full Name 1", "Full Name 2", "Age"]);
    expect(rows[1]).toEqual(["Ada Lovelace", "Ada", "Lovelace", 36]);
    const m = await mergeColumns([csv("First,Last\nAda,Lovelace")], ctx({ columns: "First, Last", separator: " ", target: "Full" }));
    expect((await rowsOf(m.files[0].blob))[1]).toEqual(["Ada", "Lovelace", "Ada Lovelace"]);
    await expect(mergeColumns([csv("First\nAda")], ctx({ columns: "First, Nope" }))).rejects.toThrow(/not found/);
  });

  it("stacks sheets with matching headers", async () => {
    const out = await mergeSheets([csv("A,B\n1,2", "one.csv"), csv("B,A\n4,3", "two.csv")], ctx({ sourceColumn: true }));
    const rows = await rowsOf(out.files[0].blob);
    expect(rows[0]).toEqual(["A", "B", "Source"]);
    expect(rows[2]).toEqual([3, 4, "two.csv / two"]);
  });

  it("compares two sheets by key column", async () => {
    const out = await compare([csv("Id,Amount\n1,10\n2,20", "a.csv"), csv("Id,Amount\n1,10\n2,25\n3,30", "b.csv")], ctx({ keyColumn: "Id" }));
    expect(out.stats).toEqual({ Changed: "1", Added: "1", Removed: "0" });
  });

  it("normalises a date column", async () => {
    const out = await formatDates([csv("Date,X\n03/01/2026,1\n1 Mar 2026,2\nnope,3")], ctx({ column: "Date", format: "yyyy-mm-dd", assume: "mdy" }));
    const rows = await rowsOf(out.files[0].blob);
    expect(rows[1][0]).toBe("2026-03-01");
    expect(rows[2][0]).toBe("2026-03-01");
    expect(rows[3][0]).toBe("nope");
    expect(out.stats?.Unrecognised).toBe("1");
  });

  it("rejects malformed workbooks", async () => {
    const junk = new File([new Uint8Array([0x50, 0x4b, 1, 2, 3])], "bad.xlsx");
    await expect(readSheets(junk)).rejects.toThrow(/Could not read/);
  });

  it("writes safe sheet names", () => {
    const blob = writeWorkbook([{ name: "a/b:c?", rows: [["x"]] }, { name: "a_b_c_", rows: [["y"]] }]);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe("accounting data tools", () => {
  const bank = "Date,Description,Amount\n03/01/2026,POS PURCHASE AMAZON #1234 03/01,-45.20\n03/02/2026,STRIPE PAYOUT,\"1,200.00\"\n03/02/2026,STRIPE PAYOUT,\"1,200.00\"\nbad,junk,";

  it("cleans transactions into a standard shape", async () => {
    const out = await transactionClean([csv(bank)], ctx({ dateColumn: "Date", descColumn: "Description", amountColumn: "Amount" }));
    const rows = await rowsOf(out.files[0].blob);
    expect(rows[0]).toEqual(["Date", "Description", "Amount", "Debit", "Credit", "Type", "Original description"]);
    expect(rows[1]).toEqual(["2026-03-01", "AMAZON 1234", -45.2, 45.2, null, "Debit", "POS PURCHASE AMAZON #1234 03/01"]);
    expect(rows[2][2]).toBe(1200);
    expect(rows[2][5]).toBe("Credit");
  });

  it("flags duplicate transactions", async () => {
    const out = await duplicateTransactions([csv(bank)], ctx({ dateColumn: "Date", descColumn: "Description", amountColumn: "Amount", windowDays: 0 }));
    expect(out.stats?.["Rows flagged"]).toBe("2");
  });

  it("splits and merges debit/credit", async () => {
    const s = await debitCredit([csv("Amount\n-10\n25")], ctx({ mode: "split", amountColumn: "Amount" }));
    const rows = await rowsOf(s.files[0].blob);
    expect(rows[1]).toEqual([-10, 10, null]);
    expect(rows[2]).toEqual([25, null, 25]);
    const m = await debitCredit([csv("Debit,Credit\n10,\n,25")], ctx({ mode: "merge" }));
    expect((await rowsOf(m.files[0].blob)).slice(1).map((r) => r[2])).toEqual([-10, 25]);
  });

  it("categorises by keyword rules", async () => {
    const out = await categorize([csv("Description\nAmazon order\nUber ride\nMystery")], ctx({ descColumn: "Description", rules: "amazon = Office\nuber = Travel", fallback: "Other" }));
    expect((await rowsOf(out.files[0].blob)).slice(1).map((r) => r[1])).toEqual(["Office", "Travel", "Other"]);
    expect(out.stats?.Categorised).toBe("2 / 3");
  });

  it("normalises amount strings", async () => {
    const out = await normalizeAmounts([csv("Amount\n\"$1,234.50\"\n(500)\nn/a")], ctx({ columns: "Amount" }));
    expect((await rowsOf(out.files[0].blob)).slice(1).map((r) => r[0])).toEqual([1234.5, -500, "n/a"]);
  });
});
