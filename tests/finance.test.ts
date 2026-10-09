import { describe, it, expect } from "vitest";
import * as c from "@/processors/finance/calculators";
import { salesTax, loanPayment, mileage, paymentTerms, prorate, businessDays, allocate } from "@/processors/finance/us";
import { parseAmount } from "@/processors/shared/amounts";
import { parseDate, formatDate } from "@/processors/shared/dates";

describe("finance calculators", () => {
  it("sales tax exclusive and inclusive", async () => {
    const ex = await salesTax({ options: { amount: 1000, rate: 8.25, mode: "exclusive" } });
    expect((ex.data as { total: number }).total).toBeCloseTo(1082.5);
    const inc = await salesTax({ options: { amount: 1082.5, rate: 8.25, mode: "inclusive" } });
    expect((inc.data as { net: number }).net).toBeCloseTo(1000);
  });
  it("loan payment, mileage, terms, proration, business days, allocation", async () => {
    expect((await loanPayment({ options: { principal: 350000, rate: 6.5, years: 30 } })).data).toMatchObject({ payment: expect.closeTo(2212.24, 0) });
    expect((await mileage({ options: { miles: 100, rate: 0.7 } })).data).toMatchObject({ total: 70 });
    const terms = await paymentTerms({ options: { amount: 10000, invoiceDate: "03/01/2026", discount: 2, discountDays: 10, netDays: 30 } });
    expect((terms.data as { annualized: number }).annualized).toBeCloseTo(37.24, 0);
    expect(terms.stats?.["Pay by (discount)"]).toContain("03/11/2026");
    expect((await prorate({ options: { amount: 3000, start: "03/16/2026", end: "03/31/2026" } })).data).toMatchObject({ prorated: expect.closeTo(1548.39, 1) });
    expect((await businessDays({ options: { start: "03/02/2026", end: "03/13/2026" } })).data).toMatchObject({ count: 10 });
    expect((await businessDays({ options: { start: "03/06/2026", add: 1 } })).stats?.["+1 business days"]).toBe("03/09/2026");
    const alloc = await allocate({ options: { amount: 100, splits: "A = 1\nB = 1\nC = 1" } });
    const amounts = (alloc.data as { rows: string[][] }).rows.map((r) => Number(r[2]));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
  it("percentage modes", () => {
    expect(c.percentage("of", 15, 200).value).toBe(30);
    expect(c.percentage("is", 30, 200).value).toBe(15);
    expect(c.percentage("change", 100, 150).value).toBe(50);
    expect(c.percentage("is", 1, 0).value).toBe(0);
  });
  it("margin / markup / discount", () => {
    expect(c.margin(60, 100)).toEqual({ profit: 40, marginPct: 40, markupPct: expect.closeTo(66.67, 1) });
    expect(c.markup(60, 40).price).toBeCloseTo(84);
    expect(c.discount(100, 15)).toEqual({ final: 85, saved: 15 });
  });
  it("monthly payment matches a known amortising loan", () => {
    expect(c.emi(500000, 9, 60).emi).toBeCloseTo(10379, 0);
    expect(c.emi(1200, 0, 12).emi).toBe(100);
  });
  it("amortization schedule ends at zero balance", () => {
    const a = c.amortization(250000, 6.5, 360);
    expect(a.schedule).toHaveLength(360);
    expect(a.schedule[359].balance).toBeCloseTo(0, 2);
    expect(a.payment).toBeCloseTo(1580.17, 1);
  });
  it("interest simple vs compound", () => {
    expect(c.interest(10000, 5, 5, 0).interest).toBeCloseTo(2500);
    expect(c.interest(10000, 5, 5, 12).total).toBeCloseTo(12833.59, 0);
  });
  it("cagr, npv, irr, roi", () => {
    expect(c.cagr(100000, 180000, 5).cagrPct).toBeCloseTo(12.47, 1);
    expect(c.npv(10, [-100000, 30000, 40000, 50000, 20000])).toBeCloseTo(11556.59, 1);
    const irr = c.irr([-100000, 30000, 40000, 50000, 20000]);
    expect(irr).not.toBeNull();
    expect(c.npv(irr! * 100, [-100000, 30000, 40000, 50000, 20000])).toBeCloseTo(0, 2);
    expect(irr! * 100).toBeGreaterThan(10);
    expect(c.irr([100, 100, 100])).toBeNull();
    expect(c.roi(50000, 65000, 2).roiPct).toBe(30);
    expect(c.roi(50000, 65000, 2).annualizedPct).toBeCloseTo(14.02, 1);
  });
  it("break-even and depreciation", () => {
    expect(c.breakEven(50000, 25, 15)!.units).toBe(5000);
    expect(c.breakEven(1, 10, 10)).toBeNull();
    const sl = c.straightLine(20000, 2000, 5);
    expect(sl[4].bookValue).toBeCloseTo(2000);
    const db = c.decliningBalance(20000, 2000, 5, 2);
    expect(db[0].depreciation).toBe(8000);
    expect(db[4].bookValue).toBeCloseTo(2000);
    expect(db.every((y) => y.depreciation >= 0)).toBe(true);
  });
});

describe("amount parsing", () => {
  it.each([
    ["$1,234.50", 1234.5],
    ["(500.00)", -500],
    ["1.234,50", 1234.5],
    ["500 CR", 500],
    ["500 DR", -500],
    ["-1,000", -1000],
    ["USD 12", 12],
    ["12.5-", -12.5],
    ["1,234", 1234],
    ["12,50", 12.5],
    ["", null],
    ["abc", null],
  ])("parses %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
  it("respects an explicit decimal style", () => {
    expect(parseAmount("1,234", "comma")).toBe(1.234);
    expect(parseAmount("1.234", "comma")).toBe(1234);
  });
});

describe("date parsing", () => {
  const iso = (v: unknown, a: "mdy" | "dmy" = "mdy") => { const d = parseDate(v, a); return d ? formatDate(d, "yyyy-mm-dd") : null; };
  it("handles common formats", () => {
    expect(iso("2026-03-01")).toBe("2026-03-01");
    expect(iso("03/01/2026")).toBe("2026-03-01");
    expect(iso("03/01/2026", "dmy")).toBe("2026-01-03");
    expect(iso("13/01/2026")).toBe("2026-01-13"); // unambiguous
    expect(iso("1 Mar 2026")).toBe("2026-03-01");
    expect(iso("March 1, 2026")).toBe("2026-03-01");
    expect(iso("01-Mar-26")).toBe("2026-03-01");
    expect(iso(46082)).toBe("2026-03-01"); // Excel serial
    expect(iso("not a date")).toBeNull();
    expect(iso("02/30/2026")).toBeNull();
  });
  it("formats", () => {
    const d = parseDate("2026-01-31")!;
    expect(formatDate(d, "mm/dd/yyyy")).toBe("01/31/2026");
    expect(formatDate(d, "dd/mm/yyyy")).toBe("31/01/2026");
    expect(formatDate(d, "dd mmm yyyy")).toBe("31 Jan 2026");
  });
});
