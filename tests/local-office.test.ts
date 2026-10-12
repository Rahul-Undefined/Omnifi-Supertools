import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PptxWriter } from "../src/processors/shared/pptxwriter";
import { DocxWriter } from "../src/processors/shared/docxwriter";

/**
 * Local-only harness: writes generated Office files to OFFICE_OUT so they can be
 * opened with real PowerPoint/Word (COM automation) on a developer machine.
 * Skipped unless OFFICE_OUT is set.
 */
const out = process.env.OFFICE_OUT;

describe.skipIf(!out)("generate Office files for local validation", () => {
  it("writes a pptx and a docx", async () => {
    mkdirSync(out!, { recursive: true });
    const p = new PptxWriter("Writer check");
    p.titleSlide("Omnifi SuperTools", "Generated deck check");
    p.sectionSlide("Section one", "What this covers");
    p.bulletSlide("Bullets", ["First point", { text: "Nested point", level: 1 }, "Third point with a longer sentence to wrap across the slide width"]);
    p.textSlide("Paragraphs", ["Paragraph one is here.", "Paragraph two follows with more text."]);
    p.tableSlide("Table", [["Account", "Q1", "Q2"], ["Revenue", "1,200", "1,450"], ["Costs", "800", "910"]]);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 231, 23, 108, 221, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    p.imageSlide("Image", png, "png", 1, 1, "A one-pixel image");
    const pf = await p.save("writer-check.pptx");
    writeFileSync(path.join(out!, pf.name), new Uint8Array(await pf.blob.arrayBuffer()));

    const d = new DocxWriter("Writer check");
    d.para("Omnifi SuperTools", { style: "Title" });
    d.heading("Heading one", 1);
    d.para([{ text: "Bold " , bold: true }, { text: "italic ", italic: true }, { text: "code", code: true }, { text: " and a " }, { text: "link", link: "https://www.myomnifi.com/" }]);
    d.heading("Lists", 2);
    d.bullets(["One", "Two", { parts: "Nested", level: 1 }]);
    d.bullets(["First", "Second"], true);
    d.quote("A quoted line.");
    d.code("const x = 1;\nconsole.log(x);");
    d.table([["Account", "Q1", "Q2"], ["Revenue", "1,200", "1,450"], ["Costs", "800", "910"]]);
    d.image(png, "png", 1, 1, "Caption");
    d.pageBreak();
    d.heading("Second page", 1);
    d.para("Done.");
    const df = await d.save("writer-check.docx");
    writeFileSync(path.join(out!, df.name), new Uint8Array(await df.blob.arrayBuffer()));
    expect(pf.bytes).toBeGreaterThan(1000);
    expect(df.bytes).toBeGreaterThan(1000);
  });
});
