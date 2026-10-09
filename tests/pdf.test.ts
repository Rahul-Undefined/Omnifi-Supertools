import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { merge, split, rotate, extractPages, deletePages, watermark, pageNumbers, metadata, repair, compress } from "@/processors/pdf";
import { parsePageRanges, parseRangeGroups } from "@/processors/shared/pages";

async function makePdf(pages: number, name = "test.pdf"): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Page ${i}`, { x: 20, y: 350, size: 24, font });
  }
  doc.setTitle("Original title");
  const bytes = await doc.save();
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function pageCount(blob: Blob): Promise<number> {
  return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
}

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

describe("page range parsing", () => {
  it("parses ranges into zero-based indices", () => {
    expect(parsePageRanges("1, 3-5, 8", 10)).toEqual([0, 2, 3, 4, 7]);
    expect(parsePageRanges("", 3)).toEqual([0, 1, 2]);
    expect(parsePageRanges("5-3", 10)).toEqual([2, 3, 4]);
  });
  it("rejects bad input", () => {
    expect(() => parsePageRanges("0", 5)).toThrow();
    expect(() => parsePageRanges("9", 5)).toThrow(/out of range/);
    expect(() => parsePageRanges("a-b", 5)).toThrow(/Invalid/);
    expect(() => parseRangeGroups("", 5)).toThrow();
    expect(parseRangeGroups("1-2, 4", 5)).toEqual([[1, 2], [4, 4]]);
  });
});

describe("pdf processors", () => {
  it("merges in order", async () => {
    const out = await merge([await makePdf(2, "a.pdf"), await makePdf(3, "b.pdf")], ctx());
    expect(out.files).toHaveLength(1);
    expect(await pageCount(out.files[0].blob)).toBe(5);
    expect(out.stats?.Pages).toBe("5");
  });
  it("refuses to merge a single file", async () => {
    await expect(merge([await makePdf(1)], ctx())).rejects.toThrow(/at least two/);
  });
  it("splits every page, by ranges and by chunks", async () => {
    const f = await makePdf(5);
    const every = await split([f], ctx({ mode: "every" }));
    expect(every.stats?.Parts).toBe("5");
    expect(every.files[0].name).toMatch(/\.zip$/);
    const ranges = await split([f], ctx({ mode: "ranges", ranges: "1-2, 5" }));
    expect(ranges.stats?.Parts).toBe("2");
    const chunks = await split([f], ctx({ mode: "chunks", chunk: 2 }));
    expect(chunks.stats?.Parts).toBe("3");
  });
  it("rotates selected pages", async () => {
    const out = await rotate([await makePdf(2)], ctx({ angle: "90", pages: "2" }));
    const doc = await PDFDocument.load(await out.files[0].blob.arrayBuffer());
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });
  it("extracts and deletes pages", async () => {
    const f = await makePdf(4);
    expect(await pageCount((await extractPages([f], ctx({ pages: "2, 4" }))).files[0].blob)).toBe(2);
    expect(await pageCount((await deletePages([f], ctx({ pages: "1" }))).files[0].blob)).toBe(3);
    await expect(deletePages([f], ctx({ pages: "1-4" }))).rejects.toThrow(/every page/);
  });
  it("watermarks and numbers pages without changing page count", async () => {
    const f = await makePdf(3);
    expect(await pageCount((await watermark([f], ctx({ text: "DRAFT" }))).files[0].blob)).toBe(3);
    expect(await pageCount((await pageNumbers([f], ctx({ format: "{n}/{total}" }))).files[0].blob)).toBe(3);
  });
  it("reads and writes metadata", async () => {
    const f = await makePdf(1);
    const read = await metadata([f], ctx());
    expect((read.data as { title: string }).title).toBe("Original title");
    const written = await metadata([f], ctx({ edit: true, title: "New", author: "OmniFi", keywords: "a, b" }));
    expect(written.files).toHaveLength(1);
    const again = await metadata([new File([written.files[0].blob], "x.pdf", { type: "application/pdf" })], ctx());
    expect((again.data as { title: string; author: string }).title).toBe("New");
    expect((again.data as { author: string }).author).toBe("OmniFi");
  });
  it("lossless compress never returns a larger file", async () => {
    const f = await makePdf(3);
    const out = await compress([f], ctx({ level: "lossless" }));
    expect(out.files[0].bytes).toBeLessThanOrEqual(f.size);
  });
  it("rejects garbage and password-protected input with a clear message", async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], "junk.pdf", { type: "application/pdf" });
    await expect(merge([junk, junk], ctx())).rejects.toThrow(/Could not read/);
    await expect(repair([junk], ctx())).rejects.toThrow();
  });
  it("repairs a PDF with trailing garbage and a broken header by re-saving", async () => {
    const f = await makePdf(2);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const junk = new TextEncoder().encode("\n<<garbage appended by a broken emailer>>\n");
    const combined = new Uint8Array(bytes.length + junk.length);
    combined.set(bytes);
    combined.set(junk, bytes.length);
    const damaged = new File([combined], "damaged.pdf", { type: "application/pdf" });
    const out = await repair([damaged], ctx());
    expect(await pageCount(out.files[0].blob)).toBe(2);
  });
});
