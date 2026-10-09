import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { protect, flatten, formFields, fillForm, applyPageOps, sign } from "@/processors/pdf/advanced";
import { convert, fiscalQuarter, unitConvert, dateMath } from "@/processors/utilities/units";
import { statementSplit } from "@/processors/finance/statement";
import * as XLSX from "xlsx";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

async function makePdf(pages = 2, withForm = false): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([300, 400]).drawText(`Page ${i}`, { x: 20, y: 350, size: 20, font });
  if (withForm) {
    const form = doc.getForm();
    const page = doc.getPage(0);
    form.createTextField("Name").addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    form.createCheckBox("Agree").addToPage(page, { x: 20, y: 150, width: 20, height: 20 });
    const rg = form.createRadioGroup("Plan");
    rg.addOptionToPage("Basic", page, { x: 20, y: 100 });
    rg.addOptionToPage("Pro", page, { x: 60, y: 100 });
  }
  return new File([(await doc.save()) as BlobPart], "doc.pdf", { type: "application/pdf" });
}

describe("advanced PDF", () => {
  it("encrypts with a password", async () => {
    const out = await protect([await makePdf()], ctx({ password: "secret1", allowPrint: true }));
    const bytes = new Uint8Array(await out.files[0].blob.arrayBuffer());
    expect(new TextDecoder("latin1").decode(bytes)).toMatch(/\/Encrypt/);
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
    await expect(protect([await makePdf()], ctx({ password: "ab" }))).rejects.toThrow(/at least 4/);
  });

  it("reads, fills and flattens form fields", async () => {
    const f = await makePdf(1, true);
    const fields = await formFields([f], ctx());
    const list = (fields.data as { fields: { name: string; type: string }[] }).fields;
    expect(list.map((x) => x.name).sort()).toEqual(["Agree", "Name", "Plan"]);
    const filled = await fillForm(f, { Name: "Rahul", Agree: "true", Plan: "Pro" }, false, f.name);
    const doc = await PDFDocument.load(await filled.blob.arrayBuffer());
    expect(doc.getForm().getTextField("Name").getText()).toBe("Rahul");
    expect(doc.getForm().getCheckBox("Agree").isChecked()).toBe(true);
    expect(doc.getForm().getRadioGroup("Plan").getSelected()).toBe("Pro");
    const flat = await flatten([new File([filled.blob], "x.pdf")], ctx());
    const fdoc = await PDFDocument.load(await flat.files[0].blob.arrayBuffer());
    expect(fdoc.getForm().getFields()).toHaveLength(0);
  });

  it("reorders and rotates pages", async () => {
    const out = await applyPageOps(await makePdf(3), [{ index: 2, rotation: 90 }, { index: 0, rotation: 0 }]);
    const doc = await PDFDocument.load(await out.blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    await expect(applyPageOps(await makePdf(1), [])).rejects.toThrow(/at least one/);
  });

  it("stamps a signature image", async () => {
    const png = await PDFDocument.create(); // build a tiny PNG via canvas-free route: use a known 1x1 PNG
    void png;
    const onePx = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const img = new File([onePx], "sig.png", { type: "image/png" });
    const out = await sign([await makePdf(2), img], ctx({ page: "last", position: "bottom-right", width: 20 }));
    expect(out.files[0].name).toBe("doc-signed.pdf");
    await expect(sign([await makePdf(1)], ctx())).rejects.toThrow(/signature image/);
  });
});

describe("units and dates", () => {
  it("converts units", () => {
    expect(convert("length", 1, "mile", "km")).toBeCloseTo(1.609344, 5);
    expect(convert("weight", 10, "lbs", "kg")).toBeCloseTo(4.5359, 3);
    expect(convert("temperature", 212, "f", "c")).toBeCloseTo(100);
    expect(convert("volume", 1, "gallon", "liter")).toBeCloseTo(3.7854, 3);
    expect(() => convert("length", 1, "parsec", "m")).toThrow(/Unknown length unit/);
  });
  it("runs the converter tool with all targets", async () => {
    const out = await unitConvert(ctx({ category: "length", value: 2, from: "ft", to: "" }));
    expect((out.data as { rows: string[][] }).rows.length).toBeGreaterThan(5);
  });
  it("computes fiscal quarters", () => {
    const d = new Date("2026-08-15T00:00:00Z");
    expect(fiscalQuarter(d, 1)).toMatchObject({ q: 3, fy: 2026 });
    expect(fiscalQuarter(d, 10)).toMatchObject({ q: 4, fy: 2026 }); // FY starts Oct: Aug 2026 is Q4 of FY2026
    expect(fiscalQuarter(new Date("2026-11-15T00:00:00Z"), 10)).toMatchObject({ q: 1, fy: 2027 });
    expect(fiscalQuarter(new Date("2026-05-10T00:00:00Z"), 7)).toMatchObject({ q: 4, fy: 2026 });
  });
  it("date math modes", async () => {
    expect((await dateMath(ctx({ mode: "between", start: "01/01/2026", end: "03/01/2026" }))).data).toMatchObject({ days: 59 });
    expect((await dateMath(ctx({ mode: "add", start: "01/31/2026", amount: 1, unit: "months" }))).stats?.["+1 months"]).toContain("03/03/2026");
    expect((await dateMath(ctx({ mode: "add", start: "01/01/2026", amount: 2, unit: "weeks" }))).stats?.["+2 weeks"]).toContain("01/15/2026");
    expect((await dateMath(ctx({ mode: "quarter", start: "08/15/2026", fyStart: "10" }))).stats?.["Fiscal quarter"]).toBe("Q4 FY2026");
  });
});

describe("statement splitter", () => {
  const csv = "Date,Description,Amount,Account\n01/05/2026,Coffee,-4.50,Checking\n01/20/2026,Payroll,2500,Checking\n02/02/2026,Rent,-1500,Checking\n02/10/2026,Card,-80,Visa\nbad,junk,1,Visa";
  const file = () => new File([csv], "bank.csv", { type: "text/csv" });
  const sheets = async (blob: Blob) => { const wb = XLSX.read(await blob.arrayBuffer(), { type: "array" }); return wb.SheetNames; };
  it("splits by month with totals and a summary", async () => {
    const out = await statementSplit([file()], ctx({ by: "month", dateColumn: "Date", totals: true }));
    expect(await sheets(out.files[0].blob)).toEqual(["Summary", "2026-01 Jan", "2026-02 Feb"]);
    expect(out.stats?.Groups).toBe("2");
    expect(out.warnings?.[0]).toMatch(/1 rows without/);
  });
  it("splits by a column", async () => {
    const out = await statementSplit([file()], ctx({ by: "column", groupColumn: "Account" }));
    expect(await sheets(out.files[0].blob)).toEqual(["Summary", "Checking", "Visa"]);
  });
});
