import JSZip from "jszip";
import type { ProcessorFile } from "@/types/processor";
import { MIME, xmlEncode, attrEncode } from "./ooxml";

/**
 * Minimal Word writer: headings, paragraphs with inline bold/italic/code,
 * bullet and numbered lists, tables, images and page breaks. Produces a valid
 * .docx with its own styles and numbering parts.
 */

export interface Inline { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string }

export class DocxWriter {
  private body: string[] = [];
  private rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  private media: { path: string; bytes: Uint8Array }[] = [];
  private relCounter = 10;
  private imgCounter = 0;
  readonly font: string;
  title: string;

  constructor(title = "Document", font = "Calibri") {
    this.title = title;
    this.font = font;
  }

  private runs(parts: Inline[] | string): string {
    const list = typeof parts === "string" ? [{ text: parts }] : parts;
    return list.map((p) => {
      const props = [p.bold ? "<w:b/>" : "", p.italic ? "<w:i/>" : "", p.code ? `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/>` : "", p.link ? '<w:rStyle w:val="Hyperlink"/>' : ""].join("");
      const segs = p.text.split(/(\n|\t)/).map((s) => (s === "\n" ? "<w:br/>" : s === "\t" ? "<w:tab/>" : s ? `<w:t xml:space="preserve">${xmlEncode(s)}</w:t>` : "")).join("");
      const run = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${segs}</w:r>`;
      if (p.link) {
        const id = `rId${++this.relCounter}`;
        this.rels.push({ id, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", target: p.link, external: true });
        return `<w:hyperlink r:id="${id}">${run}</w:hyperlink>`;
      }
      return run;
    }).join("");
  }

  heading(text: string, level: 1 | 2 | 3 | 4 = 1) {
    this.body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${this.runs(text)}</w:p>`);
  }
  para(parts: Inline[] | string, opts: { align?: "left" | "center" | "right"; style?: string } = {}) {
    const ppr = [opts.style ? `<w:pStyle w:val="${opts.style}"/>` : "", opts.align && opts.align !== "left" ? `<w:jc w:val="${opts.align === "center" ? "center" : "right"}"/>` : ""].join("");
    this.body.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${this.runs(parts)}</w:p>`);
  }
  quote(text: string) { this.para(text, { style: "Quote" }); }
  code(text: string) {
    for (const line of text.split(/\r?\n/)) this.body.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${this.runs([{ text: line || " ", code: false }])}</w:p>`);
  }
  bullets(items: (Inline[] | string | { parts: Inline[] | string; level: number })[], numbered = false) {
    for (const it of items) {
      const level = typeof it === "object" && !Array.isArray(it) && "level" in it ? it.level : 0;
      const parts = typeof it === "object" && !Array.isArray(it) && "parts" in it ? it.parts : (it as Inline[] | string);
      this.body.push(`<w:p><w:pPr><w:pStyle w:val="${numbered ? "ListNumber" : "ListBullet"}"/><w:numPr><w:ilvl w:val="${Math.min(2, level)}"/><w:numId w:val="${numbered ? 2 : 1}"/></w:numPr></w:pPr>${this.runs(parts)}</w:p>`);
    }
  }
  table(rows: string[][], opts: { header?: boolean; widths?: number[] } = {}) {
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const total = 9360; // twips, 6.5in
    const widths = opts.widths ?? Array.from({ length: cols }, () => Math.floor(total / cols));
    const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
    const trs = rows.map((r, ri) => {
      const head = opts.header !== false && ri === 0;
      const tcs = Array.from({ length: cols }, (_, ci) => `<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="0A0F3D"/>' : ri % 2 === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F5F5FA"/>' : ""}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${/^[-+$(]?[\d,.]+%?\)?$/.test((r[ci] ?? "").trim()) ? '<w:jc w:val="right"/>' : ""}</w:pPr>${this.runs([{ text: r[ci] ?? "", bold: head }]).replace(head ? "<w:rPr>" : "\u0000", '<w:rPr><w:color w:val="FFFFFF"/>')}</w:p></w:tc>`).join("");
      return `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${tcs}</w:tr>`;
    }).join("");
    this.body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9DBEA"/></w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl><w:p/>`);
  }
  image(bytes: Uint8Array, ext: "png" | "jpeg", pxW: number, pxH: number, caption = "") {
    const path = `word/media/image${++this.imgCounter}.${ext}`;
    this.media.push({ path, bytes });
    const id = `rId${++this.relCounter}`;
    this.rels.push({ id, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: `media/image${this.imgCounter}.${ext}` });
    const maxW = 5943600; // 6.5in in EMU
    const scale = Math.min(1, maxW / (pxW * 9525));
    const cx = Math.round(pxW * 9525 * scale), cy = Math.round(pxH * 9525 * scale);
    this.body.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${this.imgCounter}" name="Picture ${this.imgCounter}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${this.imgCounter}" name="image${this.imgCounter}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    if (caption) this.para(caption, { align: "center", style: "Caption" });
  }
  pageBreak() { this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); }
  raw(xml: string) { this.body.push(xml); }

  async save(name: string): Promise<ProcessorFile> {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEncode(this.title)}</dc:title><dc:creator>Omnifi SuperTools</dc:creator><cp:lastModifiedBy>Omnifi SuperTools</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><Company>Omnifi</Company></Properties>`);
    const baseRels = [
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", target: "styles.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", target: "numbering.xml" },
      { id: "rId3", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", target: "settings.xml" },
      ...this.rels,
    ];
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${baseRels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${attrEncode(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`);
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${this.body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    zip.file("word/styles.xml", stylesXml(this.font));
    zip.file("word/numbering.xml", numberingXml());
    zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
    for (const m of this.media) zip.file(m.path, m.bytes);
    const blob = await zip.generateAsync({ type: "blob", mimeType: MIME.docx, compression: "DEFLATE" });
    return { name, blob, bytes: blob.size, mime: MIME.docx };
  }
}

export function stylesXml(font: string): string {
  const f = attrEncode(font);
  const h = (n: number, size: number, color: string) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${h(1, 32, "0A0F3D")}${h(2, 26, "0A0F3D")}${h(3, 24, "4F5BD5")}${h(4, 22, "4F5BD5")}<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="0A0F3D"/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4F5BD5"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="4A4F6E"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="6B72B8"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="4F5BD5"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
}

export function numberingXml(): string {
  const lvl = (i: number, bullet: boolean) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? "bullet" : i === 0 ? "decimal" : i === 1 ? "lowerLetter" : "lowerRoman"}"/><w:lvlText w:val="${bullet ? (i === 0 ? "" : i === 1 ? "o" : "") : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr>${bullet ? `<w:rPr><w:rFonts w:ascii="${i === 1 ? "Courier New" : "Symbol"}" w:hAnsi="${i === 1 ? "Courier New" : "Symbol"}" w:hint="default"/></w:rPr>` : ""}</w:lvl>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((i) => lvl(i, true)).join("")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((i) => lvl(i, false)).join("")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
}
