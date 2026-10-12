import JSZip from "jszip";
import type { ProcessorFile } from "@/types/processor";
import { MIME, xmlEncode, attrEncode } from "./ooxml";

/**
 * Minimal PowerPoint writer: produces a valid .pptx (16:9) with an Omnifi-styled
 * blank layout and slides built from title / bullets / table / image / section
 * shapes. No placeholders are used, so PowerPoint never asks to repair it.
 */

const W = 12192000; // EMU
const H = 6858000;
const EMU_PER_PT = 12700;
export const SLIDE_PT = { w: W / EMU_PER_PT, h: H / EMU_PER_PT }; // 960 x 540

export interface PptxTheme { accent: string; dark: string; text: string; muted: string; font: string }
const DEFAULT_THEME: PptxTheme = { accent: "4F5BD5", dark: "0A0F3D", text: "1F2340", muted: "6B72B8", font: "Calibri" };

type Slide = { xml: string; rels: { id: string; type: string; target: string }[] };

export class PptxWriter {
  private slides: Slide[] = [];
  private media: { path: string; bytes: Uint8Array }[] = [];
  private imgCount = 0;
  readonly theme: PptxTheme;
  title: string;

  constructor(title = "Presentation", theme: Partial<PptxTheme> = {}) {
    this.title = title;
    this.theme = { ...DEFAULT_THEME, ...theme };
  }

  get slideCount() { return this.slides.length; }

  /* ----- Slide builders ----- */

  titleSlide(title: string, subtitle = "") {
    const shapes = [
      this.rect(0, 0, W, H, this.theme.dark),
      this.textBox(title, 914400, 2200000, W - 1828800, 1500000, { size: 40, bold: true, color: "FFFFFF", anchor: "b" }),
      subtitle ? this.textBox(subtitle, 914400, 3800000, W - 1828800, 900000, { size: 20, color: "C9CCF0" }) : "",
      this.rect(914400, 3700000, 1200000, 45720, this.theme.accent),
    ];
    this.push(shapes);
  }

  sectionSlide(title: string, subtitle = "") {
    const shapes = [
      this.rect(0, 0, 457200, H, this.theme.accent),
      this.textBox(title, 914400, 2400000, W - 1828800, 1200000, { size: 36, bold: true, color: this.theme.dark, anchor: "b" }),
      subtitle ? this.textBox(subtitle, 914400, 3650000, W - 1828800, 800000, { size: 18, color: this.theme.muted }) : "",
    ];
    this.push(shapes);
  }

  bulletSlide(title: string, bullets: (string | { text: string; level?: number })[], notes?: string) {
    const items = bullets.map((b) => (typeof b === "string" ? { text: b, level: 0 } : { text: b.text, level: b.level ?? 0 }));
    const size = items.length > 10 ? 14 : items.length > 7 ? 16 : items.length > 5 ? 18 : 20;
    const shapes = [
      ...this.header(title),
      this.bulletBox(items, 685800, 1500000, W - 1371600, H - 1900000, size),
    ];
    this.push(shapes, notes);
  }

  textSlide(title: string, paragraphs: string[]) {
    const size = paragraphs.join(" ").length > 900 ? 12 : paragraphs.join(" ").length > 500 ? 14 : 16;
    this.push([...this.header(title), this.paraBox(paragraphs, 685800, 1500000, W - 1371600, H - 1900000, size)]);
  }

  tableSlide(title: string, rows: string[][], opts: { header?: boolean } = {}) {
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const colW = Math.floor((W - 1371600) / cols);
    const rowH = Math.max(250000, Math.min(500000, Math.floor((H - 1900000) / Math.max(1, rows.length))));
    const fontSize = cols > 8 || rows.length > 14 ? 9 : cols > 6 || rows.length > 10 ? 10 : 12;
    const header = opts.header !== false;
    const trs = rows.map((r, ri) => {
      const cells = Array.from({ length: cols }, (_, ci) => {
        const txt = r[ci] ?? "";
        const isHead = header && ri === 0;
        return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${isHead ? "ctr" : /^[-+$(]?[\d,.]+%?\)?$/.test(txt.trim()) ? "r" : "l"}"/><a:r><a:rPr lang="en-US" sz="${fontSize * 100}"${isHead ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${isHead ? "FFFFFF" : this.theme.text}"/></a:solidFill><a:latin typeface="${this.theme.font}"/></a:rPr><a:t>${xmlEncode(txt)}</a:t></a:r></a:p></a:txBody><a:tcPr anchor="ctr">${isHead ? `<a:solidFill><a:srgbClr val="${this.theme.dark}"/></a:solidFill>` : ri % 2 === 0 ? '<a:solidFill><a:srgbClr val="F5F5FA"/></a:solidFill>' : ""}</a:tcPr></a:tc>`;
      }).join("");
      return `<a:tr h="${rowH}">${cells}</a:tr>`;
    }).join("");
    const grid = Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join("");
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${this.nextId()}" name="Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="685800" y="1500000"/><a:ext cx="${colW * cols}" cy="${rowH * rows.length}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${header ? 1 : 0}" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    this.push([...this.header(title), frame]);
  }

  imageSlide(title: string, bytes: Uint8Array, ext: "png" | "jpeg", pxW: number, pxH: number, caption = "") {
    const path = `ppt/media/image${++this.imgCount}.${ext}`;
    this.media.push({ path, bytes });
    const rId = "rId2";
    const boxW = W - 1371600, boxH = H - 1900000 - (caption ? 400000 : 0);
    const scale = Math.min(boxW / pxW, boxH / pxH);
    const cw = Math.round(pxW * scale), ch = Math.round(pxH * scale);
    const x = 685800 + Math.round((boxW - cw) / 2), y = 1500000 + Math.round((boxH - ch) / 2);
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="${this.nextId()}" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cw}" cy="${ch}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const shapes = [...this.header(title), pic, caption ? this.textBox(caption, 685800, H - 800000, W - 1371600, 400000, { size: 12, color: this.theme.muted, align: "ctr" }) : ""];
    this.push(shapes, undefined, [{ id: rId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: `../media/image${this.imgCount}.${ext}` }]);
  }

  /* ----- Shape helpers ----- */

  private idCounter = 1;
  private nextId() { return ++this.idCounter; }

  private header(title: string): string[] {
    return [
      this.textBox(title, 685800, 420000, W - 1371600, 900000, { size: 28, bold: true, color: this.theme.dark, anchor: "b" }),
      this.rect(685800, 1330000, 1000000, 36000, this.theme.accent),
    ];
  }

  private rect(x: number, y: number, w: number, h: number, fill: string): string {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId()}" name="Rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
  }

  private rPr(size: number, o: { bold?: boolean; color?: string; italic?: boolean } = {}) {
    return `<a:rPr lang="en-US" sz="${size * 100}"${o.bold ? ' b="1"' : ""}${o.italic ? ' i="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${o.color ?? this.theme.text}"/></a:solidFill><a:latin typeface="${this.theme.font}"/></a:rPr>`;
  }

  private textBox(text: string, x: number, y: number, w: number, h: number, o: { size: number; bold?: boolean; color?: string; anchor?: "t" | "ctr" | "b"; align?: "l" | "ctr" | "r" }): string {
    const paras = text.split(/\r?\n/).map((line) => `<a:p><a:pPr algn="${o.align ?? "l"}"/><a:r>${this.rPr(o.size, o)}<a:t>${xmlEncode(line)}</a:t></a:r></a:p>`).join("");
    return `<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId()}" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${o.anchor ?? "t"}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }

  private bulletBox(items: { text: string; level: number }[], x: number, y: number, w: number, h: number, size: number): string {
    const paras = items.map((it) => {
      const lvl = Math.min(4, Math.max(0, it.level));
      const sz = Math.max(10, size - lvl * 2);
      return `<a:p><a:pPr marL="${342900 + lvl * 342900}" lvl="${lvl}" indent="-285750"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buClr><a:srgbClr val="${this.theme.accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${lvl % 2 === 0 ? "•" : "–"}"/></a:pPr><a:r>${this.rPr(sz)}<a:t>${xmlEncode(it.text)}</a:t></a:r></a:p>`;
    }).join("");
    return `<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId()}" name="Bullets"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`;
  }

  private paraBox(paragraphs: string[], x: number, y: number, w: number, h: number, size: number): string {
    const paras = paragraphs.map((t) => `<a:p><a:pPr><a:spcBef><a:spcPts val="800"/></a:spcBef></a:pPr><a:r>${this.rPr(size)}<a:t>${xmlEncode(t)}</a:t></a:r></a:p>`).join("");
    return `<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId()}" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`;
  }

  private push(shapes: string[], notes?: string, extraRels: Slide["rels"] = []) {
    const n = this.slides.length + 1;
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.filter(Boolean).join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    this.slides.push({ xml, rels: [{ id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", target: "../slideLayouts/slideLayout1.xml" }, ...extraRels] });
    void n; void notes; // notes need a notes master; kept out on purpose so the file stays minimal and valid
  }

  /* ----- Package ----- */

  async save(name: string): Promise<ProcessorFile> {
    const zip = new JSZip();
    const t = this.theme;
    const slideOverrides = this.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEncode(this.title)}</dc:title><dc:creator>Omnifi SuperTools</dc:creator><cp:lastModifiedBy>Omnifi SuperTools</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><Slides>${this.slides.length}</Slides><Company>Omnifi</Company></Properties>`);
    const sldIds = this.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
    zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
    const presRels = this.slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("");
    const n = this.slides.length + 2;
    zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${presRels}<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId${n + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/></Relationships>`);
    zip.file("ppt/presProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
    zip.file("ppt/viewProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
    zip.file("ppt/tableStyles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
    const spTreeEmpty = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`;
    const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
    const lvl = (i: number) => `<a:lvl${i}pPr marL="${(i - 1) * 457200}" algn="l"><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl${i}pPr>`;
    const lvls = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(lvl).join("");
    zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${spTreeEmpty}${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${lvls}</p:bodyStyle><p:otherStyle>${lvls}</p:otherStyle></p:txStyles></p:sldMaster>`);
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
    zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">${spTreeEmpty}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
    zip.file("ppt/theme/theme1.xml", themeXml("Omnifi", t));
    this.slides.forEach((s, i) => {
      zip.file(`ppt/slides/slide${i + 1}.xml`, s.xml);
      zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${attrEncode(r.target)}"/>`).join("")}</Relationships>`);
    });
    for (const m of this.media) zip.file(m.path, m.bytes);
    const blob = await zip.generateAsync({ type: "blob", mimeType: MIME.pptx, compression: "DEFLATE" });
    return { name, blob, bytes: blob.size, mime: MIME.pptx };
  }
}

export function themeXml(name: string, t: PptxTheme): string {
  const fill = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  const grad = `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const effect = `<a:effectStyle><a:effectLst/></a:effectStyle>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${attrEncode(name)}"><a:themeElements><a:clrScheme name="${attrEncode(name)}"><a:dk1><a:srgbClr val="${t.text}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${t.dark}"/></a:dk2><a:lt2><a:srgbClr val="F5F5FA"/></a:lt2><a:accent1><a:srgbClr val="${t.accent}"/></a:accent1><a:accent2><a:srgbClr val="${t.dark}"/></a:accent2><a:accent3><a:srgbClr val="${t.muted}"/></a:accent3><a:accent4><a:srgbClr val="2BB673"/></a:accent4><a:accent5><a:srgbClr val="F2A33A"/></a:accent5><a:accent6><a:srgbClr val="E05252"/></a:accent6><a:hlink><a:srgbClr val="${t.accent}"/></a:hlink><a:folHlink><a:srgbClr val="${t.muted}"/></a:folHlink></a:clrScheme><a:fontScheme name="${attrEncode(name)}"><a:majorFont><a:latin typeface="${attrEncode(t.font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${attrEncode(t.font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="${attrEncode(name)}"><a:fillStyleLst>${fill}${grad}${grad}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst><a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${grad}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
