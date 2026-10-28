/**
 * Tool checker: builds random input for every tool in the registry, runs the
 * real browser processor exactly the way the tool page does, then analyses the
 * result (did it throw, did it produce the declared output, does the output
 * look like a real file, does the content make sense) before moving on.
 */
import type { ToolDefinition, OptionValues } from "@/types/tool";
import type { AnyProcessor, CalcProcessor, FileProcessor, ProcessorOutput, TextProcessor } from "@/types/processor";
import { resolveProcessor, isImplemented } from "@/processors";
import { defaultOptions } from "@/components/tools/OptionsForm";
import { detectMime } from "@/lib/files";
import * as F from "./fixtures";
import type { Rng } from "./fixtures";

export type CheckStatus = "pass" | "warn" | "fail" | "skipped" | "manual";

export interface CheckResult {
  id: string;
  name: string;
  category: string;
  kind: string;
  runtime: string;
  status: CheckStatus;
  ms: number;
  /** What the checker fed in (file names or a short text preview). */
  input: string;
  /** Output files produced (name + size) or a text preview. */
  output: string;
  /** Human-readable verdict and details. */
  comment: string;
  warnings?: string[];
  error?: string;
}

export interface CheckOptions {
  seed: number;
  includeServer: boolean;
  includeAi: boolean;
  includeMedia: boolean;
  includeOcr: boolean;
  only?: Set<string>;
  timeoutMs?: number;
}

interface Plan {
  files?: File[];
  text?: string;
  options?: OptionValues;
  /** Extra verification on the output. Return a message to downgrade to warn, throw to fail, or return undefined when happy. */
  verify?: (out: ProcessorOutput, helpers: Helpers) => Promise<string | void> | string | void;
  /** Description of the extra verification for the report. */
  verifies?: string;
  note?: string;
}

interface Helpers {
  pdfPages(file: File | Blob): Promise<number>;
  pdfText(file: File | Blob): Promise<string>;
  zipNames(file: File | Blob): Promise<string[]>;
  zipText(file: File | Blob, name: string): Promise<string>;
  sheetRows(file: File | Blob, name: string): Promise<string[][]>;
  text(file: File | Blob): Promise<string>;
}

const helpers: Helpers = {
  async pdfPages(b) { const { PDFDocument } = await import("pdf-lib"); return (await PDFDocument.load(await b.arrayBuffer(), { ignoreEncryption: true })).getPageCount(); },
  async pdfText(b) {
    const { openPdf, closePdf, pageText } = await import("@/processors/shared/pdfjs");
    const doc = await openPdf(b);
    try { const out: string[] = []; for (let p = 1; p <= doc.numPages; p++) out.push(await pageText(doc, p)); return out.join("\n"); } finally { await closePdf(doc); }
  },
  async zipNames(b) { const JSZip = (await import("jszip")).default; return Object.keys((await JSZip.loadAsync(await b.arrayBuffer())).files).filter((n) => !n.endsWith("/")); },
  async zipText(b, name) { const JSZip = (await import("jszip")).default; const z = await JSZip.loadAsync(await b.arrayBuffer()); const f = z.file(name); if (!f) throw new Error(`${name} missing from zip`); return f.async("string"); },
  async sheetRows(b, name) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await b.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error(`${name} has no sheets`);
    return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  },
  async text(b) { return b.text(); },
};

const EXT_MAGIC: Record<string, (b: Uint8Array, mime: string | null) => boolean> = {
  pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b,
  xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  pptx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  epub: (b) => b[0] === 0x50 && b[1] === 0x4b,
  png: (b) => b[0] === 0x89 && b[1] === 0x50,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  gif: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  webp: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  mp4: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  mov: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  m4a: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  mkv: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  wav: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46,
  mp3: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  ogg: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67,
  flac: (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43,
  tar: (b) => b.length > 262 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74,
};

const extOf = (n: string) => (n.split(".").pop() ?? "").toLowerCase();
const PASSWORD = "Check-1234";

/* ---------------------------------------------------------------------- */
/* Plans: what each tool gets as input and how its output is verified.     */
/* ---------------------------------------------------------------------- */

async function filesFor(tool: ToolDefinition, rng: Rng, opts: CheckOptions): Promise<File[]> {
  const kinds = F.inputKinds(tool);
  const n = tool.fileCount ?? (tool.combine ? 2 : 1);
  const one = async (k: F.InputKind): Promise<File> => {
    switch (k) {
      case "pdf": return F.pdfFile(rng);
      case "png": return F.pngImage(rng);
      case "jpg": return F.jpegImage(rng);
      case "gif": return F.gifImage(rng);
      case "csv": return F.textFile(`ledger-${rng.int(100, 999)}.csv`, F.ledgerCsv(rng), "text/csv");
      case "xlsx": return F.xlsxFile(rng);
      case "docx": return F.docxFile(rng);
      case "pptx": return F.pptxFile(rng);
      case "zip": return F.zipFile(rng, [F.textFile("a.txt", rng.paragraph()), await F.pngImage(rng, 64, 64)]);
      case "txt": return F.textFile(`notes-${rng.int(100, 999)}.txt`, F.proseSample(rng));
      case "wav": return F.wavFile(rng);
      case "webm": return F.webmVideo(rng);
      case "any": return rng.next() > 0.5 ? F.textFile(`notes-${rng.int(100, 999)}.txt`, F.proseSample(rng)) : F.pngImage(rng, 200, 120);
    }
  };
  // Prefer a concrete, generatable kind; random among the candidates so repeated runs cover more formats.
  const pool = kinds.filter((k) => !(k === "webm" && !opts.includeMedia));
  if (!pool.length) throw new Error(`No fixture generator for inputs [${tool.input.join(", ")}]`);
  const files: File[] = [];
  for (let i = 0; i < n; i++) files.push(await one(rng.pick(pool)));
  return files;
}

function textFor(tool: ToolDefinition, rng: Rng): string {
  const p = tool.processor;
  const id = tool.id;
  if (p === "image.qrGenerate") return `https://omnifi.co/${rng.words(1)}-${rng.int(1, 99)}`;
  if (p === "office.explainFormula") return `=IF(VLOOKUP(A2,Rates!A:B,2,FALSE)>0,B2*1.08,0)\n=SUMIFS(C:C,A:A,"Payroll",D:D,">="&DATE(2026,1,1))`;
  if (p === "data.jsonToCsv" || p.startsWith("dev.json") || p === "data.jsonSortKeys" || p === "data.jsonEscape" || p === "data.jsonCompare") return JSON.stringify(JSON.parse(F.jsonSample(rng)), null, 2);
  if (p === "data.changeSeparator") return F.simpleCsv(rng).replace(/,/g, ";");
  if (p.startsWith("data.") || p === "text.textToTable") return F.simpleCsv(rng);
  if (p === "pptx.agenda") return `Financial results | Revenue, margin, cash\n${rng.words(2)}\nHiring plan | Q3 and Q4\n${rng.words(3)} | ${rng.sentence()}`;
  if (p === "pptx.fromMarkdown" || p === "docx.fromMarkdown" || p === "text.markdownFormat" || p === "dev.markdown" || p === "insights.markdownToPdf") return F.markdownSample(rng);
  if (p === "dev.xmlFormat" || p === "data.xmlValidate") return F.xmlSample(rng);
  if (p === "dev.yamlFormat") return F.yamlSample(rng);
  if (p === "dev.sqlFormat") return F.sqlSample(rng);
  if (p === "dev.regexTest") return `Paid on ${rng.date()} and again on ${rng.date()} by ${rng.name()} for ${rng.words(2)}.`;
  if (p === "dev.urlEncode") return `https://example.com/search?q=${rng.words(2)}&amount=$${rng.amount()}`;
  if (p === "dev.urlDecode") return encodeURIComponent(`https://example.com/search?q=${rng.words(2)}&x=1`);
  if (p === "dev.jwtDecode") return F.jwtSample(rng);
  if (p === "dev.timestamp") return String(1735689600 + rng.int(0, 10_000_000));
  if (p === "dev.cron") return rng.pick(["0 9 * * 1-5", "*/15 * * * *", "0 0 1 * *", "30 18 * * 5"]);
  if (p === "dev.htmlFormat" || p === "text.htmlToMarkdown") return F.htmlSample(rng);
  if (p === "dev.cssFormat") return F.cssSample(rng);
  if (p === "dev.jsFormat") return F.jsSample(rng);
  if (p === "dev.color") return rng.hex();
  if (p === "web.robots") return "https://github.com"; // example.com has no robots.txt
  if (p === "web.sitemap") return "https://www.sitemaps.org/sitemap.xml";
  if (p.startsWith("web.")) return "https://example.com";
  if (p === "utilities.numberToWords") return `${rng.amount(1, 99999)}\n$${rng.int(100, 9999)}\n${rng.int(1, 999)}`;
  if (p === "utilities.numberStats") return `${rng.amount()}\n(${rng.int(10, 900)})\n$${rng.amount()}\n${rng.int(1, 50)}`;
  if (p === "utilities.timeDecimal") return `${rng.int(0, 12)}:${String(rng.int(0, 59)).padStart(2, "0")}\n1h ${rng.int(1, 59)}m\n0:50`;
  if (p === "utilities.leapYear") return `${rng.int(1900, 2100)} ${rng.int(1900, 2100)} 2024 2100`;
  if (p === "insights.emailClean") return F.emailList(rng);
  if (p === "ai.excelFormula") return `Sum column B where column A equals '${rng.pick(["Payroll", "Travel"])}' and the date in C is in Q${rng.int(1, 4)}`;
  if (p === "ai.regexAssistant") return "Match US phone numbers with or without dashes";
  if (p === "ai.sqlAssistant") return "Total paid invoices per client this year, highest first";
  if (p === "ai.codeExplain") return F.jsSample(rng);
  if (p === "ai.textToJson" || p === "ai.extractStructured" || p === "ai.extractTables") return `Invoice ${rng.int(1000, 9999)} from ${rng.company()} dated ${rng.date()}, due ${rng.date()}, total $${rng.amount(100, 9999)} USD.\nLine items:\n${rng.words(2)} 2 x $${rng.amount(10, 500)}\n${rng.words(2)} 1 x $${rng.amount(10, 500)}`;
  if (p === "ai.subjectLines" || p === "ai.emailReply") return `Hi team,\n\n${F.proseSample(rng)}\n\nCould you confirm by ${rng.date()}?\nThanks, ${rng.name()}`;
  if (p === "ai.categorizeTransactions") return F.ledgerCsv(rng, 6);
  if (p.startsWith("ai.")) return F.proseSample(rng);
  if (id === "text-counter" || p === "text.case" || p === "text.clean" || p === "text.whitespace" || p === "text.diff" || p === "text.findReplace" || p === "text.censor" || p === "text.rot13" || p === "text.randomizeCase" || p === "text.wordFrequency" || p === "text.truncateLines" || p === "text.splitText" || p === "text.extractSubstring" || p === "text.hiddenChars") return `  ${F.proseSample(rng)}​\n\n\n${rng.sentence()}  `;
  if (p.startsWith("text.")) return F.listSample(rng);
  if (p.startsWith("insights.")) return F.proseSample(rng) + "\n" + F.proseSample(rng);
  if (p === "dev.base64" || p === "dev.baseN" || p === "dev.hash") return rng.paragraph(2);
  return tool.inputPlaceholder && !/\.\.\.| or /.test(tool.inputPlaceholder) ? tool.inputPlaceholder : rng.paragraph(3);
}

/** Per-tool specialisation: inputs that need a particular shape, blank-but-required options, and output checks. */
async function specialPlan(tool: ToolDefinition, rng: Rng, opts: CheckOptions): Promise<Plan | null> {
  const id = tool.id;
  const files = () => filesFor(tool, rng, opts);
  const first = (out: ProcessorOutput) => out.files[0]?.blob;
  switch (id) {
    /* ----- PDF ----- */
    case "merge-pdf": {
      const a = await F.pdfFile(rng, { pages: 2 }), b = await F.pdfFile(rng, { pages: 3 });
      return { files: [a, b], verifies: "merged page count = 5", verify: async (o, h) => { const n = await h.pdfPages(first(o)); if (n !== 5) throw new Error(`Expected 5 pages, got ${n}`); } };
    }
    case "split-pdf": return { files: [await F.pdfFile(rng, { pages: 4 })], options: { mode: "ranges", ranges: "1-2, 3, 4" }, verifies: "3 parts", verify: async (o, h) => { const names = o.files.length === 1 && extOf(o.files[0].name) === "zip" ? await h.zipNames(first(o)) : o.files.map((f) => f.name); if (names.length !== 3) return `Expected 3 parts, got ${names.length}`; } };
    case "rotate-pdf": return { files: [await F.pdfFile(rng, { pages: 2 })], verifies: "page count unchanged", verify: async (o, h) => { if ((await h.pdfPages(first(o))) !== 2) throw new Error("Page count changed"); } };
    case "extract-pdf-pages": return { files: [await F.pdfFile(rng, { pages: 3 })], options: { pages: "2-3" }, verifies: "2 pages extracted", verify: async (o, h) => { const n = await h.pdfPages(first(o)); if (n !== 2) throw new Error(`Expected 2 pages, got ${n}`); } };
    case "delete-pdf-pages": return { files: [await F.pdfFile(rng, { pages: 3 })], options: { pages: "1" }, verifies: "2 pages remain", verify: async (o, h) => { const n = await h.pdfPages(first(o)); if (n !== 2) throw new Error(`Expected 2 pages, got ${n}`); } };
    case "jpg-to-pdf": case "image-to-pdf": return { files: [await F.jpegImage(rng), await F.pngImage(rng)], verifies: "2 pages", verify: async (o, h) => { const n = await h.pdfPages(first(o)); if (n !== 2) throw new Error(`Expected 2 pages, got ${n}`); } };
    case "pdf-to-jpg": case "pdf-to-image": return { files: [await F.pdfFile(rng, { pages: 2 })], verifies: "one image per page", verify: async (o, h) => { const names = o.files.length === 1 && extOf(o.files[0].name) === "zip" ? await h.zipNames(first(o)) : o.files.map((f) => f.name); if (names.length < 2) throw new Error(`Expected 2 images, got ${names.length}`); } };
    case "ocr-pdf": case "image-to-text": { if (!opts.includeOcr) return { note: "skip:OCR is switched off for this run" }; const { file } = await F.ocrImage(rng); return { files: [file], verifies: "recognised text contains INVOICE", verify: async (o, h) => { const t = (o.text ?? "") + (o.files[0] ? await h.text(o.files[0].blob) : ""); if (!/INVOICE/i.test(t)) throw new Error(`OCR text was ${JSON.stringify(t.slice(0, 80))}`); } }; }
    case "extract-pdf-text": return { files: [await F.pdfFile(rng)], verifies: "text contains 'Statement Date'", verify: async (o, h) => { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : ""); if (!/Statement Date/.test(t)) throw new Error("Extracted text does not contain the page heading"); } };
    case "extract-pdf-tables": return { files: [await F.pdfFile(rng)], verifies: "CSV has rows", verify: async (o, h) => { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : ""); if (t.split("\n").length < 3) return "Fewer than 3 CSV rows found"; } };
    case "watermark-pdf": return { files: [await F.pdfFile(rng, { pages: 1 })], options: { text: "CHECKER" }, verifies: "watermark text present", verify: async (o, h) => { if (!/CHECKER/.test(await h.pdfText(first(o)))) return "Watermark text not found in page text"; } };
    case "pdf-metadata": return { files: [await F.pdfFile(rng, { pages: 1 })], options: { edit: true, title: "Checker title", author: "Checker" }, verifies: "title saved", verify: async (o) => { const { PDFDocument } = await import("pdf-lib"); const d = await PDFDocument.load(await first(o).arrayBuffer()); if (d.getTitle() !== "Checker title") throw new Error(`Title is ${JSON.stringify(d.getTitle())}`); } };
    case "pdf-page-numbers": return { files: [await F.pdfFile(rng, { pages: 2 })], verifies: "'1 / 2' drawn", verify: async (o, h) => { if (!/1 \/ 2/.test(await h.pdfText(first(o)))) return "Page number text not found"; } };
    case "pdf-compare": return { files: [await F.pdfFile(rng, { pages: 1 }), await F.pdfFile(rng, { pages: 1 })] };
    case "protect-pdf": return { files: [await F.pdfFile(rng, { pages: 1 })], options: { password: PASSWORD }, verifies: "output is encrypted", verify: async (o) => { const head = new TextDecoder("latin1").decode(new Uint8Array(await first(o).arrayBuffer())); if (!/\/Encrypt\b/.test(head)) throw new Error("Output has no /Encrypt dictionary"); } };
    case "unlock-pdf": return { files: [await F.protectedPdf(rng, PASSWORD)], options: { password: PASSWORD }, verifies: "output opens without a password", verify: async (o, h) => { const head = new TextDecoder("latin1").decode(new Uint8Array(await first(o).arrayBuffer())); if (/\/Encrypt\b/.test(head)) throw new Error("Output is still encrypted"); if (!/Statement Date/.test(await h.pdfText(first(o)))) throw new Error("Text lost after unlock"); } };
    case "redact-pdf-text": return { files: [await F.pdfFile(rng, { pages: 1 })], options: { terms: "CONFIDENTIAL" }, verifies: "term removed from text layer", verify: async (o, h) => { if (/CONFIDENTIAL/.test(await h.pdfText(first(o)))) throw new Error("Term is still readable in the output"); } };
    case "flatten-pdf": case "pdf-form-fields": return { files: [await F.pdfFile(rng, { pages: 1, form: true })], verifies: id === "pdf-form-fields" ? "field names listed" : "fields removed", verify: async (o, h) => { if (id === "pdf-form-fields") { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : JSON.stringify(o.data ?? "")); if (!/client\.name/.test(t)) throw new Error("Field 'client.name' not listed"); } else { const { PDFDocument } = await import("pdf-lib"); const d = await PDFDocument.load(await first(o).arrayBuffer()); if (d.getForm().getFields().length) return "Form fields still present after flatten"; } } };
    case "sign-pdf": return { files: [await F.pdfFile(rng, { pages: 1 }), await F.pngImage(rng, 300, 120, "Signature")] };
    case "split-pdf-smart": return { files: [await F.pdfFile(rng, { pages: 3, marker: "Statement Date" })], verifies: "split by marker into 3", verify: async (o, h) => { const names = o.files.length === 1 && extOf(o.files[0].name) === "zip" ? await h.zipNames(first(o)) : o.files.map((f) => f.name); if (names.length !== 3) return `Expected 3 statements, got ${names.length}`; } };
    case "pdf-extract-images": return { files: [await F.pdfFile(rng, { pages: 2 })], verifies: "2 images extracted", verify: async (o, h) => { const n = (await h.zipNames(first(o))).length; if (n < 1) throw new Error("No images extracted"); } };
    case "pdf-to-epub": return { files: [await F.pdfFile(rng)], verifies: "EPUB has mimetype + content", verify: async (o, h) => { const names = await h.zipNames(first(o)); if (!names.includes("mimetype")) throw new Error("EPUB is missing the mimetype entry"); if (!names.some((n) => /\.x?html$/.test(n))) throw new Error("EPUB has no chapters"); } };
    /* ----- Images ----- */
    case "qr-reader": { const payload = `https://omnifi.co/check/${rng.int(1000, 9999)}`; return { files: [await F.qrImage(payload)], verifies: "decoded payload matches", verify: (o) => { if (!(o.text ?? "").includes(payload)) throw new Error(`Decoded ${JSON.stringify(o.text)} instead of the payload`); } }; }
    case "resize-image": return { files: [await F.pngImage(rng, 800, 600)], options: { mode: "width", width: 400 }, verifies: "width becomes 400", verify: async (o) => { const dim = await imageSize(first(o)); if (dim.w !== 400) throw new Error(`Width is ${dim.w}`); } };
    case "crop-image": return { files: [await F.pngImage(rng, 800, 600)], verifies: "output smaller than input", verify: async (o) => { const dim = await imageSize(first(o)); if (dim.w * dim.h >= 800 * 600) return "Output is not smaller"; } };
    case "rotate-image": return { files: [await F.pngImage(rng, 800, 400)], verifies: "dimensions swap", verify: async (o) => { const dim = await imageSize(first(o)); if (dim.w === 800 && dim.h === 400) return "Dimensions unchanged (rotation may be 0/180)"; } };
    case "split-image": return { files: [await F.pngImage(rng, 400, 400)], verifies: "4 tiles", verify: async (o, h) => { const n = (await h.zipNames(first(o))).length; if (n !== 4) throw new Error(`Expected 4 tiles, got ${n}`); } };
    case "favicon-generator": return { files: [await F.pngImage(rng, 512, 512)], verifies: "zip has .ico + manifest", verify: async (o, h) => { const n = await h.zipNames(first(o)); if (!n.some((x) => x.endsWith(".ico"))) return "No favicon.ico in the zip"; } };
    case "gif-to-video": return { files: [F.gifImage(rng)] };
    case "video-to-gif": case "video-thumbnail": case "frame-extractor": case "video-converter": case "video-compressor": case "video-trimmer": case "extract-audio": case "video-metadata": return { files: [await F.webmVideo(rng, 2)], options: id === "video-trimmer" ? { start: "00:00:00", end: "00:00:01" } : undefined };
    case "video-merger": return { files: [await F.webmVideo(rng, 1), await F.webmVideo(rng, 1)] };
    case "audio-cutter": return { files: [F.wavFile(rng, 3)], options: { start: "00:00:00", end: "00:00:02" } };
    /* ----- Excel ----- */
    case "excel-dedupe": return { files: [await F.xlsxFile(rng, { dupes: true })], verifies: "2 duplicate rows removed", verify: async (o, h) => { const rows = await h.sheetRows(first(o), o.files[0].name); if (rows.length !== 21) return `Expected 21 rows (header + 20), got ${rows.length}`; } };
    case "excel-column-split": return { files: await files(), options: { column: "Description", delimiter: " " } };
    case "excel-column-merge": return { files: await files(), options: { columns: "Date, Description", separator: " | ", target: "Merged" } };
    case "excel-sheet-merge": case "excel-consolidator": return { files: [await F.xlsxFile(rng), await F.xlsxFile(rng)] };
    case "excel-sheet-extract": return { files: [await F.xlsxFile(rng, { sheets: 3 })], verifies: "3 outputs", verify: async (o, h) => { const names = o.files.length === 1 && extOf(o.files[0].name) === "zip" ? await h.zipNames(first(o)) : o.files.map((f) => f.name); if (names.length !== 3) return `Expected 3 sheets, got ${names.length}`; } };
    case "excel-compare": return { files: [await F.xlsxFile(rng), await F.xlsxFile(rng)], options: { keyColumn: "Description" } };
    case "excel-formatter": return { files: await files(), options: { numberColumns: "Amount", upperColumns: "Account", titleColumns: "Customer" } };
    case "excel-formula-audit": return { files: [await F.xlsxFile(rng, { formulas: true })], verifies: "report lists the #N/A formula", verify: async (o, h) => { const rows = await h.sheetRows(first(o), o.files[0].name); if (!JSON.stringify(rows).includes("VLOOKUP")) return "Audit report does not mention the VLOOKUP formula"; } };
    case "office-metadata": return { files: [await F.docxFile(rng)] };
    /* ----- PowerPoint ----- */
    case "pptx-merge": return { files: [await F.pptxFile(rng, { slides: 2 }), await F.pptxFile(rng, { slides: 2 })], verifies: "slide count adds up (6 + 6 = 12)", verify: async (o, h) => { const n = (await h.zipNames(first(o))).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length; if (n !== 12) throw new Error(`Expected 12 slides, got ${n}`); } };
    case "pptx-split": return { files: [await F.pptxFile(rng, { slides: 2 })], options: { mode: "extract", ranges: "2-3" }, verifies: "extracted deck has 2 slides", verify: async (o, h) => { const n = (await h.zipNames(first(o))).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length; if (n !== 2) throw new Error(`Expected 2 slides, got ${n}`); } };
    case "pptx-find-replace": return { files: [await F.pptxFile(rng)], options: { pairs: "quarterly review => annual review" }, verifies: "replacement present", verify: async (o, h) => { const xml = await h.zipText(first(o), "ppt/slides/slide1.xml"); if (!/annual review/.test(xml)) throw new Error("Replacement text not found on slide 1"); } };
    case "pptx-font-color": return { files: [await F.pptxFile(rng)], options: { fontFrom: "Calibri", fontTo: "Arial" } };
    case "pptx-compare": return { files: [await F.pptxFile(rng, { slides: 2 }), await F.pptxFile(rng, { slides: 3 })] };
    case "excel-to-pptx": case "csv-to-chart-slide": return { files: [F.textFile("numbers.csv", F.simpleCsv(rng, 6), "text/csv")] };
    case "pptx-to-images": return { files: [await F.pptxFile(rng, { slides: 1 })], verifies: "one image per slide (4)", verify: async (o, h) => { const names = o.files.length === 1 && extOf(o.files[0].name) === "zip" ? await h.zipNames(first(o)) : o.files.map((f) => f.name); if (names.length < 4) return `Expected 4 images, got ${names.length}`; } };
    /* ----- Word ----- */
    case "docx-merge": return { files: [await F.docxFile(rng), await F.docxFile(rng)], verifies: "both headings present", verify: async (o, h) => { const xml = await h.zipText(first(o), "word/document.xml"); if ((xml.match(/engagement summary/g) ?? []).length < 2) throw new Error("Second document text missing"); } };
    case "docx-find-replace": return { files: [await F.docxFile(rng)], options: { pairs: "engagement summary => checker summary" }, verifies: "replacement present", verify: async (o, h) => { if (!/checker summary/.test(await h.zipText(first(o), "word/document.xml"))) throw new Error("Replacement text not found"); } };
    case "docx-font-color": return { files: [await F.docxFile(rng)], options: { fontFrom: "Calibri", fontTo: "Arial" } };
    case "docx-header-footer": return { files: [await F.docxFile(rng)], options: { header: "Checker header", footer: "Page {page}" }, verifies: "header part created", verify: async (o, h) => { const names = await h.zipNames(first(o)); if (!names.some((n) => /word\/header\d*\.xml/.test(n))) throw new Error("No header part in output"); } };
    case "docx-mail-merge": return { files: [await F.docxFile(rng, { template: true, name: "template.docx" }), F.textFile("list.csv", F.simpleCsv(rng, 3), "text/csv")], options: { nameColumn: "Name" }, verifies: "3 letters in zip", verify: async (o, h) => { const n = (await h.zipNames(first(o))).filter((x) => x.endsWith(".docx")).length; if (n !== 3) throw new Error(`Expected 3 letters, got ${n}`); } };
    case "docx-compare": return { files: [await F.docxFile(rng), await F.docxFile(rng)] };
    case "docx-tables-to-excel": return { files: [await F.docxFile(rng)], verifies: "table rows copied", verify: async (o, h) => { const rows = await h.sheetRows(first(o), o.files[0].name); if (rows.length < 3) throw new Error(`Expected 3 rows, got ${rows.length}`); } };
    case "docx-image-extractor": case "pptx-image-extractor": return { files: [id.startsWith("docx") ? await F.docxFile(rng) : await F.pptxFile(rng)], verifies: "1 image in zip", verify: async (o, h) => { if (!(await h.zipNames(first(o))).length) throw new Error("No images extracted"); } };
    case "excel-to-docx": return { files: [F.textFile("numbers.csv", F.simpleCsv(rng, 5), "text/csv")] };
    /* ----- Finance ----- */
    case "bank-reconciliation": { const csv = F.ledgerCsv(rng, 15); const lines = csv.split("\n"); const ledger = [lines[0], ...lines.slice(1, 12), ...lines.slice(1, 3)].join("\n"); return { files: [F.textFile("bank.csv", csv, "text/csv"), F.textFile("ledger.csv", ledger, "text/csv")] }; }
    case "ar-aging": return { files: await files(), options: { asOf: "2026-12-31" } };
    case "duplicate-transactions": return { files: [F.textFile("ledger.csv", F.ledgerCsv(rng, 15, { dupes: true }), "text/csv")], verifies: "duplicates flagged", verify: async (o, h) => { const rows = await h.sheetRows(first(o), o.files[0].name); if (!JSON.stringify(rows).match(/dup/i)) return "No duplicate marker found in the report"; } };
    case "bank-statement-to-excel": return { files: [await F.pdfFile(rng, { pages: 1, withImage: false })], verifies: "rows extracted", verify: async (o, h) => { const rows = await h.sheetRows(first(o), o.files[0].name); if (rows.length < 5) return `Only ${rows.length} rows extracted`; } };
    case "batch-ocr-statements": { if (!opts.includeOcr) return { note: "skip:OCR is switched off for this run" }; return { files: [await F.ocrStatementImage(rng), await F.ocrStatementImage(rng)], verifies: "transactions recognised from scanned statements", verify: async (o, h) => { const x = o.files.find((f) => extOf(f.name) === "xlsx"); if (!x) throw new Error("No workbook produced"); const rows = await h.sheetRows(x.blob, x.name); if (rows.length < 4) throw new Error(`Only ${rows.length} rows recognised`); } }; }
    /* ----- Files ----- */
    case "zip-creator": return { files: [F.textFile("a.txt", rng.paragraph()), await F.pngImage(rng, 64, 64)], verifies: "2 entries", verify: async (o, h) => { if ((await h.zipNames(first(o))).length !== 2) throw new Error("Zip does not contain exactly the 2 inputs"); } };
    case "zip-extractor": return { files: [await F.zipFile(rng, [F.textFile("a.txt", rng.paragraph()), await F.pngImage(rng, 64, 64)])], verifies: "3 files out", verify: (o) => { if (o.files.length < 3) throw new Error(`Expected 3 files, got ${o.files.length}`); } };
    case "file-splitter": return { files: [new File([new Uint8Array(3 * 1024 * 1024)], "big.bin")], options: { chunkMb: 1 }, verifies: "zip with 3 chunks", verify: async (o, h) => { const n = (await h.zipNames(first(o))).length; if (n !== 3) throw new Error(`Expected 3 chunks, got ${n}`); } };
    case "file-merger": return { files: [F.textFile("a.txt", "hello "), F.textFile("b.txt", "world")], options: { name: "merged.txt" }, verifies: "bytes concatenated", verify: async (o, h) => { if ((await h.text(first(o))) !== "hello world") throw new Error("Merged content is wrong"); } };
    case "file-hash": return { files: [F.textFile("a.txt", "abc")], verifies: "SHA-256 of 'abc'", verify: async (o, h) => { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : ""); if (!/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/i.test(t)) throw new Error("SHA-256 of 'abc' not found in output"); } };
    case "duplicate-finder": { const same = rng.paragraph(); return { files: [F.textFile("a.txt", same), F.textFile("b.txt", same), F.textFile("c.txt", rng.paragraph())], verifies: "a/b reported as duplicates", verify: async (o, h) => { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : ""); if (!/a\.txt/.test(t) || !/b\.txt/.test(t)) throw new Error("Duplicate pair not reported"); } }; }
    case "file-base64": return { files: [F.textFile("a.txt", "abc")], verifies: "YWJj", verify: async (o, h) => { const t = o.text ?? (o.files[0] ? await h.text(first(o)) : ""); if (!/YWJj/.test(t)) throw new Error("Base64 of 'abc' not found"); } };
    case "tar-tools": return { files: [F.textFile("a.txt", rng.paragraph())] };
    case "batch-renamer": return { files: [F.textFile("a.txt", "1"), F.textFile("b.txt", "2")], options: { pattern: "{n}-{name}", find: "", replace: "" }, verifies: "2 renamed files + rename map", verify: async (o, h) => { const n = await h.zipNames(first(o)); const renamed = n.filter((x) => x.endsWith(".txt")); if (renamed.length !== 2 || !n.includes("rename-map.csv")) throw new Error(`Zip contains ${n.join(", ")}`); if (!renamed.every((x) => /^\d+-/.test(x))) throw new Error(`Pattern not applied: ${renamed.join(", ")}`); } };
    /* ----- Text tools with blank-but-required options or exact checks ----- */
    case "case-converter": return { text: "hello Checker world", options: { to: "upper" }, verifies: "uppercase", verify: (o) => { if (o.text !== "HELLO CHECKER WORLD") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "dedupe-lines": return { text: "a\nb\na\nc\nb", verifies: "3 unique lines", verify: (o) => { if ((o.text ?? "").split("\n").length !== 3) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "sort-lines": return { text: "pear\napple\nmango", verifies: "alphabetical", verify: (o) => { if (o.text !== "apple\nmango\npear") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "reverse-lines": return { text: "1\n2\n3", verifies: "reversed", verify: (o) => { if (o.text !== "3\n2\n1") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "text-diff": { const a = F.proseSample(rng); return { text: a, options: { b: a.replace(/Action/, "Owner") + "\nExtra line" }, verifies: "diff mentions the change", verify: (o) => { const t = (o.text ?? "") + JSON.stringify(o.data ?? ""); if (!/Extra line/.test(t)) throw new Error("Added line not reported"); } }; }
    case "find-replace": return { text: "The ledger and the ledger again", options: { find: "ledger", replace: "journal" }, verifies: "both replaced", verify: (o) => { if (o.text !== "The journal and the journal again") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "prefix-suffix": return { text: "a\nb", options: { prefix: "- ", suffix: ";" }, verifies: "exact", verify: (o) => { if (o.text !== "- a;\n- b;") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "extract-substring": return { text: "Invoice [123] paid\nInvoice [456] open", options: { mode: "between", start: "[", end: "]" }, verifies: "123 and 456", verify: (o) => { if (!/123/.test(o.text ?? "") || !/456/.test(o.text ?? "")) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "censor-words": return { text: "the secret plan", options: { words: "secret" }, verifies: "masked", verify: (o) => { if (/secret/.test(o.text ?? "")) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "rot13": return { text: "Hello", verifies: "Uryyb", verify: (o) => { if (o.text !== "Uryyb") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "slug-generator": return { text: "Hello World, Omnifi!", verifies: "hello-world-omnifi", verify: (o) => { if (o.text?.trim() !== "hello-world-omnifi") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "join-lines": return { text: "a\nb\nc", verifies: "a, b, c", verify: (o) => { if (o.text !== "a, b, c") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "text-counter": return { text: "one two three", verifies: "3 words", verify: (o) => { if (!/3/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("Word count 3 not reported"); } };
    case "json-formatter": case "text-json-formatter": return { text: '{"b":1,"a":[1,2]}', verifies: "valid, indented JSON", verify: (o) => { JSON.parse(o.text ?? ""); if (!/\n/.test(o.text ?? "")) throw new Error("Output is not indented"); } };
    case "json-minifier": return { text: '{ "a" : 1 ,\n "b": [1, 2] }', verifies: "minified", verify: (o) => { if (o.text !== '{"a":1,"b":[1,2]}') throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "json-validator": return { text: F.jsonSample(rng), verifies: "valid JSON accepted (invalid JSON is reported as an error by design)", verify: (o) => { if (!/valid/i.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) return "Did not say the JSON is valid"; } };
    case "json-compare": { const a = F.jsonSample(rng); return { text: a, options: { b: a.replace(/"paid":(true|false)/, '"paid":"changed"') }, verifies: "difference reported", verify: (o) => { if (!/changed|paid/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("Changed key not reported"); } }; }
    case "json-to-csv": return { text: F.jsonSample(rng), verifies: "CSV header has name,amount", verify: (o) => { if (!/name/.test((o.text ?? "").split("\n")[0])) throw new Error("Header row missing 'name'"); } };
    case "csv-separator": return { text: "a;b\n1;2", options: { from: "auto", to: "comma" }, verifies: "a,b", verify: (o) => { if (!/^a,b/.test(o.text ?? "")) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "csv-swap-columns": return { text: "a,b\n1,2", options: { a: "1", b: "2" }, verifies: "b,a", verify: (o) => { if (!/^b,a/.test(o.text ?? "")) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "csv-insert-column": return { text: "a,b\n1,2", options: { name: "c", position: "", where: "after", mode: "value", fill: "x" }, verifies: "new column", verify: (o) => { if (!/c/.test((o.text ?? "").split("\n")[0])) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "base64": return { text: "Omnifi", verifies: "T21uaWZp", verify: (o) => { if (o.text?.trim() !== "T21uaWZp") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "hash-generator": return { text: "abc", verifies: "SHA-256 present", verify: (o) => { if (!/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/i.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("SHA-256 of 'abc' not found"); } };
    case "url-encoder": return { text: "a b&c", verifies: "a%20b%26c", verify: (o) => { if (o.text?.trim() !== "a%20b%26c") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "url-decoder": return { text: "a%20b%26c", verifies: "a b&c", verify: (o) => { if (o.text?.trim() !== "a b&c") throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "jwt-decoder": return { text: F.jwtSample(rng), verifies: "payload decoded", verify: (o) => { if (!/HS256/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("Header alg not shown"); } };
    case "uuid-generator": return { options: { count: 4 }, verifies: "4 UUIDs", verify: (o) => { const m = (o.text ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) ?? []; if (m.length !== 4) throw new Error(`Found ${m.length} UUIDs`); } };
    case "timestamp-converter": return { text: "1735689600", verifies: "2025-01-01", verify: (o) => { if (!/2025-01-01/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("Date 2025-01-01 not shown"); } };
    case "color-converter": return { text: "#FF0000", verifies: "rgb(255, 0, 0)", verify: (o) => { if (!/255,\s*0,\s*0/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("RGB value not shown"); } };
    case "regex-tester": case "text-regex-tester": return { text: "Paid 2026-03-01 and 2026-04-01", options: { pattern: "\\d{4}-\\d{2}-\\d{2}", flags: "g" }, verifies: "2 matches", verify: (o) => { if (!/2026-03-01/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) throw new Error("Match not listed"); } };
    case "number-to-words": return { text: "1234.56", verifies: "thousand", verify: (o) => { if (!/thousand/i.test(o.text ?? "")) throw new Error(`Got ${JSON.stringify(o.text)}`); } };
    case "leap-year": return { text: "2024 2100", verifies: "2024 yes, 2100 no", verify: (o) => { const t = o.text ?? ""; if (!/2024/.test(t) || !/2100/.test(t)) throw new Error(`Got ${JSON.stringify(t)}`); } };
    case "similarity-check": { const a = F.proseSample(rng); return { text: a, options: { b: a } }; }
    case "payment-terms": return { options: { invoiceDate: "2026-03-01" } };
    case "proration-calculator": return { options: { start: "2026-03-10", end: "2026-03-31" } };
    case "business-days": return { options: { start: "2026-03-02", end: "2026-03-31" } };
    case "date-math": return { options: { start: "2026-01-01", end: "2026-03-31" } };
    case "timezone-converter": return { options: { datetime: "2026-03-01T09:30" } };
    case "unit-converter": return { options: { category: "length", value: 1, from: "mile", to: "kilometer" }, verifies: "1.609", verify: (o) => { if (!/1\.60/.test((o.text ?? "") + JSON.stringify(o.data ?? ""))) return "Expected 1.609 km in the result"; } };
    case "markdown-to-pptx": return { text: F.markdownSample(rng), verifies: "slides created", verify: async (o, h) => { const n = (await h.zipNames(first(o))).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length; if (n < 2) throw new Error(`Only ${n} slides`); } };
    case "markdown-to-docx": return { text: F.markdownSample(rng), verifies: "heading present", verify: async (o, h) => { if (!/Highlights/.test(await h.zipText(first(o), "word/document.xml"))) throw new Error("Heading text missing"); } };
    case "qr-generator": return { text: "https://omnifi.co", verifies: "PNG output" };
    case "ai-document-qa": return { files: [await F.pdfFile(rng, { pages: 1 })], options: { question: "What is the account number?" } };
    default: return null;
  }
}

async function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const r = { w: bmp.width, h: bmp.height };
  bmp.close();
  return r;
}

/* ---------------------------------------------------------------------- */
/* Runner                                                                  */
/* ---------------------------------------------------------------------- */

export function shouldSkip(tool: ToolDefinition, opts: CheckOptions, customProcessors: string[]): { status: CheckStatus; comment: string } | null {
  if (tool.status !== "ready") return { status: "skipped", comment: "Marked coming soon in the registry (no processor yet)" };
  if (tool.kind === "custom") return customProcessors.includes(tool.processor) ? { status: "manual", comment: "Interactive tool: component is registered and loads; needs a human to drive it" } : { status: "fail", comment: `Interactive tool has no component registered for ${tool.processor}` };
  if (!isImplemented(tool.processor)) return { status: "fail", comment: `Processor family for ${tool.processor} is not registered` };
  if (tool.processor.startsWith("ai.") && !opts.includeAi) return { status: "skipped", comment: "AI tool: excluded (uses the shared AI allowance). Tick 'Include AI tools' to test." };
  if (tool.runtime === "server" && !tool.processor.startsWith("ai.") && !opts.includeServer) return { status: "skipped", comment: "Server tool: excluded (needs network). Tick 'Include server tools' to test." };
  if (tool.category === "media" && !opts.includeMedia) return { status: "skipped", comment: "Media tool: excluded (loads the 30 MB FFmpeg engine). Tick 'Include media tools' to test." };
  return null;
}

export async function checkTool(tool: ToolDefinition, rng: Rng, opts: CheckOptions, customProcessors: string[]): Promise<CheckResult> {
  const base = { id: tool.id, name: tool.name, category: tool.category, kind: tool.kind, runtime: tool.runtime };
  const skip = shouldSkip(tool, opts, customProcessors);
  if (skip) return { ...base, ...skip, ms: 0, input: "", output: "" };

  const started = performance.now();
  let plan: Plan = {};
  try {
    plan = (await specialPlan(tool, rng, opts)) ?? {};
    if (plan.note?.startsWith("skip:")) return { ...base, status: "skipped", comment: plan.note.slice(5), ms: 0, input: "", output: "" };
    if (tool.kind === "file" && !plan.files) plan.files = await filesFor(tool, rng, opts);
    if (tool.kind === "text" && plan.text === undefined) plan.text = textFor(tool, rng);
  } catch (e) {
    return { ...base, status: "fail", comment: `Checker could not build test input: ${msg(e)}`, ms: Math.round(performance.now() - started), input: "", output: "", error: msg(e) };
  }
  const options: OptionValues = { ...defaultOptions(tool.options), ...(plan.options ?? {}) };
  const inputDesc = plan.files ? plan.files.map((f) => `${f.name} (${fmtBytes(f.size)})`).join(", ") : tool.kind === "text" ? preview(plan.text ?? "") : Object.entries(options).map(([k, v]) => `${k}=${v}`).join(", ");

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? (tool.category === "media" || /ocr|batch-ocr|image-to-text/.test(tool.id) ? 240_000 : 90_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let out: ProcessorOutput;
  try {
    const fn: AnyProcessor = await resolveProcessor(tool.processor);
    const ctx = { options, signal: controller.signal, onProgress: () => {} };
    const run = tool.kind === "file" ? (fn as FileProcessor)(plan.files!, ctx) : tool.kind === "text" ? (fn as TextProcessor)(plan.text ?? "", ctx) : (fn as CalcProcessor)(ctx);
    out = await Promise.race([run, new Promise<never>((_, rej) => controller.signal.addEventListener("abort", () => rej(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s`))))]);
  } catch (e) {
    clearTimeout(timer);
    const m = msg(e);
    const hint = (e as { hint?: string })?.hint;
    return { ...base, status: "fail", comment: `Threw: ${m}${hint ? ` (hint: ${hint})` : ""}`, ms: Math.round(performance.now() - started), input: inputDesc, output: "", error: m };
  }
  clearTimeout(timer);
  const ms = Math.round(performance.now() - started);

  // ----- Analyse -----
  const problems: string[] = [];
  const notes: string[] = [];
  const outDesc = out.files.length ? out.files.map((f) => `${f.name} (${fmtBytes(f.blob.size)})`).join(", ") : out.text ? preview(out.text) : out.data !== undefined ? "structured data" : "";
  if (!out.files.length && !(out.text && out.text.trim()) && out.data === undefined) problems.push("Produced no files, text or data");
  for (const f of out.files) {
    if (f.blob.size === 0) { problems.push(`${f.name} is empty (0 bytes)`); continue; }
    const head = new Uint8Array(await f.blob.slice(0, 512).arrayBuffer());
    const ext = extOf(f.name);
    const magic = EXT_MAGIC[ext];
    if (magic && !magic(head, detectMime(head))) problems.push(`${f.name} does not look like a real .${ext} file (bad header)`);
    if (ext === "json") { try { JSON.parse(await f.blob.text()); } catch { problems.push(`${f.name} is not valid JSON`); } }
    if ((ext === "csv" || ext === "txt" || ext === "md") && !(await f.blob.text()).trim()) problems.push(`${f.name} is blank`);
  }
  if (tool.kind === "file" && out.files.length) {
    const declared = tool.output.map((o) => o.toLowerCase());
    const exts = [...new Set(out.files.map((f) => extOf(f.name)))];
    const okExt = (e: string) => declared.includes("*") || declared.includes(e) || (e === "jpeg" && declared.includes("jpg")) || (e === "yml" && declared.includes("yaml")) || e === "zip";
    const bad = exts.filter((e) => !okExt(e));
    if (bad.length) notes.push(`Output extension .${bad.join("/.")} is not in the declared outputs (${declared.join(", ")})`);
  }
  if (out.warnings?.length) notes.push(...out.warnings.map((w) => `Tool warned: ${w}`));
  let verified = "";
  if (plan.verify && !problems.length) {
    try {
      const r = await plan.verify(out, helpers);
      if (r) notes.push(r); else verified = plan.verifies ? `Verified: ${plan.verifies}.` : "Verified.";
    } catch (e) { problems.push(`Check failed (${plan.verifies ?? "content"}): ${msg(e)}`); }
  }
  if (ms > 30_000) notes.push(`Slow: ${(ms / 1000).toFixed(1)} s`);

  const status: CheckStatus = problems.length ? "fail" : notes.length ? "warn" : "pass";
  const comment = problems.length ? problems.join("; ") : [verified || "Ran without errors and produced the expected kind of output.", ...notes].join(" ");
  return { ...base, status, ms, input: inputDesc, output: outDesc, comment, warnings: notes.length ? notes : undefined };
}

export async function* runChecks(tools: ToolDefinition[], opts: CheckOptions, customProcessors: string[], signal?: AbortSignal): AsyncGenerator<CheckResult> {
  for (const tool of tools) {
    if (signal?.aborted) return;
    if (opts.only && !opts.only.has(tool.id)) continue;
    const rng = new F.Rng(hash(`${opts.seed}:${tool.id}`));
    yield await checkTool(tool, rng, opts, customProcessors);
  }
}

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function preview(t: string): string { const s = t.replace(/\s+/g, " ").trim(); return s.length > 90 ? s.slice(0, 90) + "…" : s; }
function fmtBytes(n: number): string { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }

export function toCsv(results: CheckResult[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["id", "name", "category", "kind", "runtime", "status", "ms", "input", "output", "comment"];
  return [head.join(","), ...results.map((r) => head.map((k) => esc((r as unknown as Record<string, unknown>)[k])).join(","))].join("\n");
}
