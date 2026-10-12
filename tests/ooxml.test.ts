import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { replaceInXml, paragraphText, relativeTarget, resolveTarget, replaceFont, replaceColor, parseRels, addRel, nextRelId, removeRel } from "../src/processors/shared/ooxml";
import { PptxWriter } from "../src/processors/shared/pptxwriter";
import { DocxWriter } from "../src/processors/shared/docxwriter";
import * as pptx from "../src/processors/pptx";
import * as docx from "../src/processors/docx";
import { acceptAllChanges, stripComments, parseBody } from "../src/processors/docx";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });
const toFile = async (f: { blob: Blob; name: string }, type: string) => new File([await f.blob.arrayBuffer()], f.name, { type });
const readZip = async (f: { blob: Blob }) => JSZip.loadAsync(await f.blob.arrayBuffer());

describe("OOXML text replacement", () => {
  it("replaces inside a single run and keeps spaces", () => {
    const xml = '<w:p><w:r><w:t>Hello Acme Corp team</w:t></w:r></w:p>';
    const r = replaceInXml(xml, "w", "Acme Corp", "Omnifi");
    expect(r.count).toBe(1);
    expect(r.xml).toContain("<w:t>Hello Omnifi team</w:t>");
  });
  it("replaces a match split across runs", () => {
    const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Ac</w:t></w:r><w:r><w:t>me Co</w:t></w:r><w:r><w:t>rp 2025</w:t></w:r></w:p>';
    const r = replaceInXml(xml, "w", "Acme Corp", "Omnifi");
    expect(r.count).toBe(1);
    expect(paragraphText(r.xml, "w")).toBe("Omnifi 2025");
    expect(r.xml).toContain("<w:b/>");
  });
  it("supports case-insensitive, whole word and regex", () => {
    const xml = "<a:p><a:r><a:t>FY2025 results, fy2025 plan, FY20256</a:t></a:r></a:p>";
    expect(replaceInXml(xml, "a", "fy2025", "FY2026", { wholeWord: true }).count).toBe(2);
    expect(replaceInXml(xml, "a", "fy2025", "X", { caseSensitive: true }).count).toBe(1);
    expect(paragraphText(replaceInXml(xml, "a", "FY(\\d{4})", "FY$1-R", { regex: true }).xml, "a")).toContain("FY2025-R results");
  });
  it("adds xml:space when the result starts or ends with a space", () => {
    const r = replaceInXml("<w:p><w:r><w:t>X-Y</w:t></w:r></w:p>", "w", "Y", "Y ");
    expect(r.xml).toContain('<w:t xml:space="preserve">X-Y </w:t>');
  });
});

describe("OOXML helpers", () => {
  it("resolves and relativises part paths", () => {
    expect(resolveTarget("ppt/slides/slide1.xml", "../media/image1.png")).toBe("ppt/media/image1.png");
    expect(relativeTarget("ppt/slides/slide1.xml", "ppt/media/image1.png")).toBe("../media/image1.png");
    expect(relativeTarget("ppt/presentation.xml", "ppt/slides/slide3.xml")).toBe("slides/slide3.xml");
  });
  it("replaces fonts and colours in both namespaces", () => {
    expect(replaceFont('<a:latin typeface="Calibri"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>', "calibri", "Aptos").count).toBe(3);
    expect(replaceColor('<a:srgbClr val="1f3a93"/><w:color w:val="1F3A93"/>', "#1F3A93", "#4F5BD5").xml).toContain('val="4F5BD5"/><w:color w:val="4F5BD5"');
  });
  it("manages relationships", () => {
    let rels = '<Relationships><Relationship Id="rId1" Type="t" Target="a.xml"/><Relationship Id="rId3" Type="t" Target="b.xml"/></Relationships>';
    expect(nextRelId(rels)).toBe("rId4");
    rels = addRel(rels, "rId4", "t", "c.xml");
    expect(parseRels(rels).map((r) => r.id)).toEqual(["rId1", "rId3", "rId4"]);
    expect(parseRels(removeRel(rels, "rId3")).map((r) => r.id)).toEqual(["rId1", "rId4"]);
  });
});

describe("PowerPoint tools on generated decks", () => {
  async function deck(name: string, n: number) {
    const w = new PptxWriter(name);
    w.titleSlide(name, "sub");
    for (let i = 1; i < n; i++) w.bulletSlide(`${name} slide ${i + 1}`, [`Point ${i}`, "Acme Corp is great"]);
    return toFile(await w.save(`${name}.pptx`), PPTX);
  }
  it("lists, extracts and splits slides", async () => {
    const d = await deck("A", 4);
    const r = await pptx.extractText([d], ctx({ format: "md" }));
    expect(r.stats?.Slides).toBe("4");
    expect(r.text).toContain("## Slide 2: A slide 2");
    const s = await pptx.splitDeck([d], ctx({ mode: "extract", ranges: "2-3" }));
    const slides = await pptx.listSlides(await readZip(s.files[0]));
    expect(slides).toHaveLength(2);
    expect(pptx.slideParagraphs(slides[0].xml).title).toBe("A slide 2");
    const each = await pptx.splitDeck([d], ctx({ mode: "each" }));
    expect(each.files[0].name).toMatch(/zip$/);
  });
  it("merges decks keeping every slide's parts valid", async () => {
    const a = await deck("A", 3), b = await deck("B", 3);
    const m = await pptx.mergeDecks([a, b], ctx({ ranges: "all; 2-3" }));
    const zip = await readZip(m.files[0]);
    const slides = await pptx.listSlides(zip);
    expect(slides).toHaveLength(5);
    expect(pptx.slideParagraphs(slides[4].xml).title).toBe("B slide 3");
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect((pres.match(/<p:sldMasterId /g) ?? []).length).toBe(2);
    expect(zip.file("ppt/slideMasters/slideMaster2.xml")).toBeTruthy();
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/ppt/slides/slide5.xml"');
    const rels = await zip.file("ppt/slides/_rels/slide5.xml.rels")!.async("string");
    expect(rels).toContain("slideLayout2.xml");
  });
  it("finds and replaces, cleans and audits", async () => {
    const d = await deck("A", 3);
    const r = await pptx.findReplace([d], ctx({ pairs: "Acme Corp => Omnifi" }));
    expect(r.stats?.Replacements).toBe("2");
    const t = await pptx.extractText([await toFile(r.files[0], PPTX)], ctx());
    expect(t.text).toContain("Omnifi is great");
    const c = await pptx.cleanCopy([d], ctx());
    expect(c.files[0].name).toMatch(/-clean\.pptx$/);
    const a = await pptx.audit([d], ctx());
    expect(a.text).toContain("3 slides");
    const cmp = await pptx.compare([d, await toFile(r.files[0], PPTX)], ctx());
    expect(cmp.stats?.Changed).toBe("2");
  });
  it("generates decks from markdown, agenda and spreadsheets", async () => {
    const md = await pptx.fromMarkdown("# T\n\n## S1\n- a\n\n## S2\n| x | y |\n|-|-|\n| 1 | 2 |", ctx());
    expect(md.stats?.Slides).toBe("3");
    const ag = await pptx.agenda("One | first\nTwo", ctx({ title: "MBR" }));
    expect(ag.stats?.Sections).toBe("2");
    const csv = new File(["Name,Q1\nAcme,10\nGlobex,7\n"], "d.csv", { type: "text/csv" });
    const sp = await pptx.fromSpreadsheet([csv], ctx({ mode: "rows" }));
    expect(sp.stats?.Slides).toBe("3");
  });
});

describe("Word tools on generated documents", () => {
  async function document(name: string, extraHeading = "Second") {
    const d = new DocxWriter(name);
    d.heading(`${name} first`, 1);
    d.para("Dear Acme Corp, the balance is due.");
    d.bullets(["one", "two"]);
    d.table([["A", "B"], ["1", "2"]]);
    d.heading(`${name} ${extraHeading}`, 1);
    d.para("Closing paragraph.");
    return toFile(await d.save(`${name}.docx`), DOCX);
  }
  it("extracts markdown and tables", async () => {
    const f = await document("Doc");
    const r = await docx.extractText([f], ctx({ format: "md" }));
    expect(r.text).toContain("## Doc first");
    expect(r.text).toContain("- one");
    expect(r.text).toContain("| A | B |");
    const t = await docx.tablesToExcel([f], ctx());
    expect(t.stats?.Tables).toBe("1");
  });
  it("splits by heading and merges with numbering offsets", async () => {
    const f = await document("Doc");
    const s = await docx.splitDoc([f], ctx({ mode: "heading", level: 1 }));
    expect(s.stats?.Documents).toBe("2");
    const m = await docx.mergeDocs([await document("A"), await document("B")], ctx());
    const zip = await readZip(m.files[0]);
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).toContain("B first");
    expect(body).toContain('<w:br w:type="page"/>');
    expect(body).toMatch(/<w:numId w:val="4"\/>/); // the second document's bullets (numId 1) land past the base's 1-2
    const num = await zip.file("word/numbering.xml")!.async("string");
    expect((num.match(/<w:abstractNum\b/g) ?? []).length).toBe(4);
  });
  it("replaces text, accepts changes and strips comments", async () => {
    const f = await document("Doc");
    const r = await docx.findReplace([f], ctx({ pairs: "Acme Corp => Omnifi" }));
    expect(r.stats?.Replacements).toBe("1");
    const tracked = '<w:p><w:ins w:id="1" w:author="a"><w:r><w:t>kept</w:t></w:r></w:ins><w:del w:id="2" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:rPr><w:rPrChange w:id="3"><w:rPr/></w:rPrChange></w:rPr><w:t> end</w:t></w:r></w:p>';
    const acc = acceptAllChanges(tracked);
    expect(acc.count).toBe(3);
    expect(paragraphText(acc.xml, "w")).toBe("kept end");
    const com = stripComments('<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>');
    expect(com.count).toBe(1);
    expect(com.xml).toBe("<w:p><w:r><w:t>x</w:t></w:r></w:p>");
  });
  it("stamps headers/footers and runs mail merge", async () => {
    const f = await document("Doc");
    const st = await docx.headerFooter([f], ctx({ header: "CONFIDENTIAL", pageNumbers: true }));
    const zip = await readZip(st.files[0]);
    expect(zip.file("word/header1.xml")).toBeTruthy();
    expect(zip.file("word/footer1.xml")).toBeTruthy();
    expect(await zip.file("word/document.xml")!.async("string")).toContain('<w:headerReference w:type="default"');
    const tpl = await docx.fromMarkdown("Dear {{Client}}, you owe {{Amount}}.", ctx());
    const csv = new File(["Client,Amount\nAcme,$5\nGlobex,$7\n"], "d.csv", { type: "text/csv" });
    const mm = await docx.mailMerge([await toFile(tpl.files[0], DOCX), csv], ctx());
    expect(mm.stats?.Documents).toBe("2");
    const inner = await JSZip.loadAsync(await mm.files[0].blob.arrayBuffer());
    const first = Object.keys(inner.files).find((n) => n.includes("Acme"))!;
    const docZip = await JSZip.loadAsync(await inner.file(first)!.async("uint8array"));
    expect(parseBody(await docZip.file("word/document.xml")!.async("string")).map((b) => b.text).join(" ")).toContain("Dear Acme, you owe $5.");
  });
  it("audits and compares", async () => {
    const a = await document("Doc"), b = await document("Doc", "Third");
    const au = await docx.audit([a], ctx());
    expect(au.text).toContain("2 headings");
    const cmp = await docx.compare([a, b], ctx());
    expect(cmp.stats?.Added).toBe("1");
    expect(cmp.stats?.Removed).toBe("1");
  });
});
