import { describe, it, expect } from "vitest";
import { searchTools } from "@/lib/search";

describe("search", () => {
  const top = (q: string) => searchTools(q, 5).map((h) => h.tool.id);

  it("finds tools by name", () => {
    expect(top("compress pdf")[0]).toBe("compress-pdf");
    expect(top("json formatter")[0]).toBe("json-formatter");
    expect(top("gst")[0]).toBe("gst-calculator");
  });

  it("handles the homepage examples", () => {
    expect(top("Compress a PDF")[0]).toBe("compress-pdf");
    expect(top("Convert Excel to CSV")[0]).toBe("excel-to-csv");
    expect(top("Extract text from a scanned document")[0]).toBe("ocr-pdf");
    expect(top("Convert MP4 to MP3")[0]).toBe("extract-audio");
    expect(top("Compare two Excel files")[0]).toBe("excel-compare");
    expect(top("Generate a QR code")[0]).toBe("qr-generator");
  });

  it("ranks ready tools above coming-soon", () => {
    const hits = searchTools("pdf", 20);
    const firstSoon = hits.findIndex((h) => h.tool.status !== "ready");
    const lastReady = hits.map((h) => h.tool.status).lastIndexOf("ready");
    if (firstSoon >= 0) expect(lastReady).toBeLessThan(firstSoon);
  });

  it("returns nothing for empty queries and something for typos", () => {
    expect(searchTools("")).toEqual([]);
    expect(top("mrege pdf").length).toBeGreaterThan(0);
  });
});
