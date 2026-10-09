import { describe, it, expect } from "vitest";
import { resolveZone, zoneOffsetMinutes, parseLocalDateTime, convertBetweenZones } from "@/processors/utilities/timezones";
import { timezone } from "@/processors/utilities";
import { excelToPdf, docxToPdf, pptxToPdf } from "@/processors/office/topdf";
import { safeText } from "@/processors/shared/pdfwriter";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

describe("time zones", () => {
  it("resolves abbreviations and IANA names", () => {
    expect(resolveZone("IST")).toBe("Asia/Kolkata");
    expect(resolveZone("est")).toBe("America/New_York");
    expect(resolveZone("Europe/London")).toBe("Europe/London");
    expect(resolveZone("asia/kolkata")).toBe("Asia/Kolkata");
    expect(resolveZone("UTC+5")).toBe("Etc/GMT-5");
    expect(() => resolveZone("Mars/Olympus")).toThrow(/Unknown time zone/);
  });
  it("computes offsets including DST", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-240);
  });
  it("converts IST wall-clock time to EST", () => {
    const instant = parseLocalDateTime("2026-01-15 14:30", "Asia/Kolkata")!;
    expect(instant.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    const ny = convertBetweenZones(instant, "America/New_York");
    expect(ny.formatted).toContain("04:00 AM");
    expect(ny.offset).toBe("UTC-05:00");
    expect(parseLocalDateTime("03/01/2026 2:30 PM", "Asia/Kolkata")!.toISOString()).toBe("2026-03-01T09:00:00.000Z");
    expect(parseLocalDateTime("nonsense", "Asia/Kolkata")).toBeNull();
  });
  it("runs the tool end to end", async () => {
    const out = await timezone(ctx({ datetime: "2026-06-10 09:00", from: "Asia/Kolkata", to: "EST, London, Australia/Sydney" }));
    const rows = (out.data as { rows: string[][] }).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe("America/New_York");
    expect(rows[0][1]).toContain("11:30 PM");
    expect(rows[0][3]).toBe("-1 day");
    expect(rows[2][1]).toContain("01:30 PM");
  });
});

describe("Office to PDF (browser-side)", () => {
  async function pageCount(blob: Blob) {
    return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
  }

  it("normalises text for standard fonts", () => {
    expect(safeText("“smart” – dash… ₹100 日本")).toBe('"smart" - dash... Rs 100 ??');
  });

  it("renders a CSV/XLSX as a table PDF", async () => {
    const rows = ["Name,Amount,Notes", ...Array.from({ length: 120 }, (_, i) => `Row ${i + 1},${(i + 1) * 10.5},Some longer note text that should wrap nicely in the cell`)].join("\n");
    const out = await excelToPdf([new File([rows], "ledger.csv", { type: "text/csv" })], ctx({ orientation: "auto" }));
    expect(out.files[0].name).toBe("ledger.pdf");
    expect(await pageCount(out.files[0].blob)).toBeGreaterThan(1);
  });

  it("renders a DOCX with headings, lists and a table", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly close</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Revenue grew </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>12%</w:t></w:r><w:r><w:t> per Q1 results.</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Second item</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Account</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Balance</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Cash</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1,200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      ${Array.from({ length: 80 }, (_, i) => `<w:p><w:r><w:t>Paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</w:t></w:r></w:p>`).join("")}
    </w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const out = await docxToPdf([new File([bytes as BlobPart], "memo.docx")], ctx());
    expect(out.files[0].name).toBe("memo.pdf");
    expect(await pageCount(out.files[0].blob)).toBeGreaterThanOrEqual(2);
    expect(out.warnings?.some((w) => /reflowed/.test(w))).toBe(true);
  });

  it("renders PPTX slides at 16:9 with one page per slide", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", `<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>`);
    const slide = (title: string, body: string) => `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`;
    zip.file("ppt/slides/slide1.xml", slide("Agenda", "Close timeline"));
    zip.file("ppt/slides/slide2.xml", slide("Results", "Revenue up 12%"));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const out = await pptxToPdf([new File([bytes as BlobPart], "deck.pptx")], ctx());
    expect(await pageCount(out.files[0].blob)).toBe(2);
    const doc = await PDFDocument.load(await out.files[0].blob.arrayBuffer());
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(960);
    expect(Math.round(height)).toBe(540);
    expect(out.stats?.Slides).toBe("2");
  });

  it("rejects non-Office input", async () => {
    await expect(docxToPdf([new File([new Uint8Array([1, 2, 3])], "x.docx")], ctx())).rejects.toThrow(/not a valid Office file/);
  });
});
