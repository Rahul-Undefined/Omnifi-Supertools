import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";

/**
 * Small flowing-text PDF writer on top of pdf-lib, used by the browser-side
 * Office → PDF converters. Standard fonts only (no font files to ship), so
 * text is normalised to the WinAnsi range; anything else becomes "?".
 */
export const NAVY = rgb(10 / 255, 15 / 255, 61 / 255);
export const BODY = rgb(45 / 255, 53 / 255, 128 / 255);
export const MUTED = rgb(107 / 255, 114 / 255, 184 / 255);
export const WHITE = rgb(1, 1, 1);
export const PAPER = rgb(245 / 255, 245 / 255, 250 / 255);
export const BORDER = rgb(227 / 255, 229 / 255, 240 / 255);

const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "…": "...", "•": "•", " ": " ", " ": " ", " ": " ",
  "−": "-", "→": "->", "←": "<-", "✓": "v", "✔": "v", "✗": "x", "₹": "Rs ",
};

let strippedCount = 0;
export function resetStripped() { strippedCount = 0; }
export function strippedChars() { return strippedCount; }

/** Map text into the WinAnsi-encodable range used by the standard fonts. */
export function safeText(input: string): string {
  let out = "";
  for (const ch of input.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n") out += "\n";
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else if (code === 0x20AC) out += "€";
    else if (code < 32) continue;
    else { out += "?"; strippedCount++; }
  }
  return out;
}

export interface TextStyle {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: RGB;
  indent?: number;
  spaceAfter?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
}

export class PdfWriter {
  readonly doc: PDFDocument;
  page!: PDFPage;
  y = 0;
  readonly margin: number;
  readonly width: number;
  readonly height: number;
  private fonts!: { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };
  pageCount = 0;

  private constructor(doc: PDFDocument, width: number, height: number, margin: number) {
    this.doc = doc;
    this.width = width;
    this.height = height;
    this.margin = margin;
  }

  static async create(opts: { width?: number; height?: number; margin?: number; landscape?: boolean } = {}): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    let w = opts.width ?? 612;
    let h = opts.height ?? 792;
    if (opts.landscape && w < h) [w, h] = [h, w];
    const pw = new PdfWriter(doc, w, h, opts.margin ?? 54);
    pw.fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    };
    pw.addPage();
    return pw;
  }

  font(style: TextStyle = {}): PDFFont {
    if (style.bold && style.italic) return this.fonts.boldItalic;
    if (style.bold) return this.fonts.bold;
    if (style.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  addPage(): PDFPage {
    this.page = this.doc.addPage([this.width, this.height]);
    this.pageCount++;
    this.y = this.height - this.margin;
    return this.page;
  }

  get contentWidth() {
    return this.width - this.margin * 2;
  }

  ensure(heightNeeded: number) {
    if (this.y - heightNeeded < this.margin) this.addPage();
  }

  space(pt: number) {
    this.y -= pt;
    if (this.y < this.margin) this.addPage();
  }

  wrap(text: string, style: TextStyle, maxWidth: number): string[] {
    const font = this.font(style);
    const size = style.size ?? 11;
    const lines: string[] = [];
    for (const para of safeText(text).split("\n")) {
      const words = para.split(/(\s+)/).filter((w) => w.length);
      let line = "";
      for (const w of words) {
        const candidate = line + w;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line.trim()) {
          if (font.widthOfTextAtSize(candidate, size) > maxWidth && !line.trim()) {
            // Single word wider than the line: hard-break it.
            let chunk = "";
            for (const ch of w) {
              if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { lines.push(chunk); chunk = ""; }
              chunk += ch;
            }
            line = chunk;
          } else line = candidate;
        } else {
          lines.push(line.replace(/\s+$/, ""));
          line = w.trimStart();
        }
      }
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines;
  }

  /** Draw a paragraph with wrapping and page breaks. */
  text(text: string, style: TextStyle = {}) {
    const size = style.size ?? 11;
    const lh = style.lineHeight ?? size * 1.35;
    const indent = style.indent ?? 0;
    const maxWidth = this.contentWidth - indent;
    const font = this.font(style);
    const lines = this.wrap(text, style, maxWidth);
    for (const line of lines) {
      this.ensure(lh);
      const w = font.widthOfTextAtSize(line, size);
      const x = style.align === "center" ? this.margin + indent + (maxWidth - w) / 2 : style.align === "right" ? this.margin + indent + maxWidth - w : this.margin + indent;
      this.page.drawText(line, { x, y: this.y - size, size, font, color: style.color ?? BODY });
      this.y -= lh;
    }
    this.y -= style.spaceAfter ?? size * 0.5;
  }

  /** Draw text inside an absolute box (used for slides). Returns the height used. */
  textBox(text: string, x: number, yTop: number, w: number, h: number, style: TextStyle = {}) {
    const size = style.size ?? 14;
    const lh = style.lineHeight ?? size * 1.25;
    const font = this.font(style);
    const lines = this.wrap(text, style, w);
    let y = yTop;
    for (const line of lines) {
      if (y - size < yTop - h) break;
      const lw = font.widthOfTextAtSize(line, size);
      const lx = style.align === "center" ? x + (w - lw) / 2 : style.align === "right" ? x + w - lw : x;
      this.page.drawText(line, { x: lx, y: y - size, size, font, color: style.color ?? NAVY });
      y -= lh;
    }
    return yTop - y;
  }

  async image(bytes: ArrayBuffer | Uint8Array, mime: string, maxWidth = this.contentWidth, maxHeight = 400) {
    let img;
    try {
      img = mime.includes("png") ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    } catch {
      return false;
    }
    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + 8);
    this.page.drawImage(img, { x: this.margin, y: this.y - h, width: w, height: h });
    this.y -= h + 10;
    return true;
  }

  async imageAt(bytes: ArrayBuffer | Uint8Array, mime: string, x: number, yTop: number, w: number, h: number) {
    let img;
    try {
      img = mime.includes("png") ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    } catch {
      return false;
    }
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    this.page.drawImage(img, { x: x + (w - dw) / 2, y: yTop - h + (h - dh) / 2, width: dw, height: dh });
    return true;
  }

  /** Simple grid table with header styling, wrapping cells and page breaks. */
  table(rows: string[][], opts: { header?: boolean; fontSize?: number; colWidths?: number[] } = {}) {
    if (!rows.length) return;
    const size = opts.fontSize ?? 9;
    const pad = 4;
    const cols = Math.max(...rows.map((r) => r.length));
    let widths = opts.colWidths;
    if (!widths) {
      const font = this.fonts.regular;
      const natural = Array.from({ length: cols }, (_, c) => Math.max(30, ...rows.slice(0, 200).map((r) => font.widthOfTextAtSize(safeText(String(r[c] ?? "")).slice(0, 60), size) + pad * 2)));
      const total = natural.reduce((a, b) => a + b, 0);
      const scale = total > this.contentWidth ? this.contentWidth / total : 1;
      widths = natural.map((w) => w * scale);
    }
    const lh = size * 1.3;
    const drawRow = (cells: string[], isHeader: boolean, zebra: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(String(c ?? ""), { size, bold: isHeader }, widths![i] - pad * 2).slice(0, 12));
      const lines = Math.max(1, ...wrapped.map((w) => w.length));
      const rowH = lines * lh + pad * 2;
      this.ensure(rowH);
      const top = this.y;
      let x = this.margin;
      if (isHeader) this.page.drawRectangle({ x, y: top - rowH, width: widths!.reduce((a, b) => a + b, 0), height: rowH, color: NAVY });
      else if (zebra) this.page.drawRectangle({ x, y: top - rowH, width: widths!.reduce((a, b) => a + b, 0), height: rowH, color: PAPER });
      wrapped.forEach((lines, i) => {
        const w = widths![i];
        this.page.drawRectangle({ x, y: top - rowH, width: w, height: rowH, borderColor: BORDER, borderWidth: 0.5 });
        lines.forEach((line, li) => {
          this.page.drawText(line, { x: x + pad, y: top - pad - size - li * lh, size, font: isHeader ? this.fonts.bold : this.fonts.regular, color: isHeader ? WHITE : BODY });
        });
        x += w;
      });
      this.y -= rowH;
    };
    rows.forEach((r, i) => drawRow(Array.from({ length: cols }, (_, c) => String(r[c] ?? "")), Boolean(opts.header) && i === 0, i % 2 === 0));
    this.y -= 12;
  }

  footer(label: string) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const t = `${label}  ·  ${i + 1} / ${pages.length}`;
      p.drawText(safeText(t), { x: this.margin, y: this.margin / 2, size: 8, font: this.fonts.regular, color: MUTED });
    });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: true });
  }
}
