import { describe, expect, it } from "vitest";
import { analyzeFormula, relativeForm, absolutize, formatAnalysis } from "../src/processors/office/formula";
import { planRenames } from "../src/processors/file/rename";
import { lineToTransaction, ocrLineToCells } from "../src/processors/finance/batch";

const msgs = (f: string) => analyzeFormula(f).issues.map((i) => i.message);

describe("formula explainer", () => {
  it("explains a nested formula in plain English", () => {
    const a = analyzeFormula("=IF(VLOOKUP(A2,Rates!$A$1:$B$50,2,FALSE)>0,B2*1.08,0)");
    expect(a.functions).toEqual(["IF", "VLOOKUP"]);
    expect(a.sheets).toEqual(["Rates"]);
    expect(a.explanation[0]).toMatch(/^IF: if .* is true then B2 times 1.08, otherwise 0/);
    expect(a.explanation.join("\n")).toContain("VLOOKUP: look for A2");
    expect(a.explanation.join("\n")).toContain("exact match");
    expect(a.issues.some((i) => i.level === "error")).toBe(false);
  });

  it("flags unbalanced brackets and unclosed text", () => {
    expect(msgs("=SUM(A1:A5")).toContain("SUM( is never closed");
    expect(msgs("=SUM(A1:A5))")).toContain("There is an extra closing bracket )");
    expect(msgs('=A1&"abc')[0]).toMatch(/never closed/);
  });

  it("flags wrong argument counts and unknown functions", () => {
    expect(msgs("=ROUND(A1)")).toContain("ROUND needs at least 2 argument(s) but has 1");
    expect(msgs("=IF(A1,B1,C1,D1)")).toContain("IF accepts at most 3 argument(s) but has 4");
    expect(msgs("=VLOKUP(A1,B:C,2,0)")[0]).toMatch(/VLOKUP is not a function/);
    expect(msgs("=SUMIFS(A:A,B:B)")).toContain("SUMIFS arguments must come in range/criteria pairs");
  });

  it("warns on approximate lookups, relative tables and hard-coded numbers", () => {
    const m = msgs("=VLOOKUP(A2,Sheet2!A1:B50,2)");
    expect(m).toContain("VLOOKUP without the 4th argument uses APPROXIMATE match");
    expect(m).toContain("The lookup table Sheet2!A1:B50 has no $ signs");
    expect(msgs("=A1*0.0825")).toContain("Hard-coded number(s): 0.0825");
    expect(msgs("=MATCH(A1,B:B)")).toContain("MATCH without a match type uses approximate match (1)");
  });

  it("notes nested IFs, volatile functions, division guards and type mismatches", () => {
    expect(msgs("=IF(A1>1,IF(A1>2,IF(A1>3,4,3),2),1)")).toContain("3 levels of nested IF");
    expect(msgs("=OFFSET(A1,1,1)")[0]).toMatch(/OFFSET is volatile/);
    expect(msgs("=A1/B1")).toContain("Division by B1 has no guard");
    expect(msgs("=IFERROR(A1/B1,0)")).not.toContain("Division by B1 has no guard");
    expect(msgs('=IF(A1="10",1,0)')).toContain('"10" is text, not a number');
    expect(msgs("=A1+#REF!")).toContain("The formula contains #REF!");
    expect(msgs("=A1/0")).toContain("Division by zero");
  });

  it("handles structured references, external links and percentages", () => {
    const a = analyzeFormula("=SUMIFS(Sales[Amount],Sales[Region],$F$2)*10%");
    expect(a.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(a.refs).toContain("Sales[Amount]");
    expect(msgs("='[Budget.xlsx]Sheet1'!A1*2")[0]).toMatch(/points to another workbook/);
  });

  it("formats a readable report", () => {
    const t = formatAnalysis(analyzeFormula("=SUM(A1:A5)"));
    expect(t).toContain("STATUS: looks good");
    expect(t).toContain("WHAT IT DOES");
    expect(t).toContain("SUM: add up A1:A5");
  });

  it("builds position-relative forms so copied formulas compare equal", () => {
    expect(relativeForm("A1+$B$2", 1, 1)).toBe(relativeForm("A2+$B$2", 2, 1));
    expect(relativeForm("A1+$B$2", 1, 1)).not.toBe(relativeForm("A1+$B$2", 2, 1));
    expect(absolutize("A1:B50")).toBe("$A$1:$B$50");
  });
});

describe("batch renamer", () => {
  const files = [
    { name: "Scan_003.pdf", size: 10, lastModified: Date.UTC(2026, 0, 5) },
    { name: "Scan_001.pdf", size: 30, lastModified: Date.UTC(2026, 0, 3) },
    { name: "Scan_002.PDF", size: 20, lastModified: Date.UTC(2026, 0, 4) },
  ];
  const base = { pattern: "{name}", find: "", replace: "", regex: false, caseMode: "keep" as const, start: 1, sort: "name" as const, dateSource: "modified" as const };

  it("numbers in sorted order with padding and normalises extensions", () => {
    const p = planRenames(files, { ...base, pattern: "Invoice-{nn}" });
    expect(p.map((x) => x.to)).toEqual(["Invoice-01.pdf", "Invoice-02.pdf", "Invoice-03.pdf"]);
    expect(p[0].from).toBe("Scan_001.pdf");
  });

  it("supports find/replace, dates and case rules", () => {
    const p = planRenames(files, { ...base, find: "Scan_", replace: "", pattern: "{date} client {name}", caseMode: "slug" });
    expect(p[0].to).toBe("2026-01-03-client-001.pdf");
    const r = planRenames(files, { ...base, find: "scan_(\\d+)", replace: "doc$1", regex: true });
    expect(r.map((x) => x.to)).toEqual(["Scan_001.pdf", "Scan_002.pdf", "Scan_003.pdf"]); // regex is case-sensitive: nothing matched, extension normalised
  });

  it("never produces duplicate names", () => {
    const p = planRenames(files, { ...base, pattern: "same" });
    expect(new Set(p.map((x) => x.to.toLowerCase())).size).toBe(3);
  });
});

describe("statement line parsing", () => {
  it("reads text-layer cells", () => {
    expect(lineToTransaction(["01/05/2026", "AMAZON MKTPLACE", "45.20", "1,234.56"], "mdy")).toEqual({ date: "2026-01-05", desc: "AMAZON MKTPLACE", amount: 45.2, balance: 1234.56 });
    expect(lineToTransaction(["Opening balance", "1,000.00"], "mdy")).toBeNull();
  });

  it("splits OCR lines into cells", () => {
    expect(ocrLineToCells("01/05/2026 AMAZON MKTPLACE PMTS 45.20 1,234.56")).toEqual(["01/05/2026", "AMAZON MKTPLACE PMTS", "45.20", "1,234.56"]);
    expect(ocrLineToCells("Jan 5 Coffee shop 4.50")).toEqual(["Jan 5", "Coffee shop", "4.50"]);
    const t = lineToTransaction(ocrLineToCells("01/05/2026 AMAZON MKTPLACE PMTS 45.20 1,234.56"), "mdy");
    expect(t?.amount).toBe(45.2);
  });
});
