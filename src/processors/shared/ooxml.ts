import JSZip from "jszip";
import { ProcessorError } from "@/types/processor";
import type { ProcessorFile } from "@/types/processor";

/**
 * Low-level helpers for Office Open XML packages (.pptx / .docx) handled as
 * ZIP + XML text in the browser. Regex-based on purpose: the documents stay
 * byte-identical apart from the parts we touch, which is what keeps Office
 * from showing "repair" prompts.
 */

export const MIME = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const xmlDecode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
export const xmlEncode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const attrEncode = xmlEncode;
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function openPackage(file: File, kind: "pptx" | "docx" | "any" = "any"): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ProcessorError(`${file.name} is not a valid Office file`, "Only Office 2007+ formats (.pptx, .docx) are supported. Convert .ppt/.doc in Office first.");
  }
  if (kind === "pptx" && !zip.file("ppt/presentation.xml")) throw new ProcessorError(`${file.name} is not a PowerPoint (.pptx) file`);
  if (kind === "docx" && !zip.file("word/document.xml")) throw new ProcessorError(`${file.name} is not a Word (.docx) file`);
  return zip;
}

export const readPart = async (zip: JSZip, path: string): Promise<string | null> => (await zip.file(path)?.async("string")) ?? null;
export const requirePart = async (zip: JSZip, path: string): Promise<string> => {
  const s = await readPart(zip, path);
  if (s == null) throw new ProcessorError(`The file is missing ${path}`, "It may be corrupted or an unsupported variant.");
  return s;
};
export const writePart = (zip: JSZip, path: string, xml: string) => { zip.file(path, xml); };
export const removePart = (zip: JSZip, path: string) => { zip.remove(path); };

export async function savePackage(zip: JSZip, name: string, mime: string): Promise<ProcessorFile> {
  const blob = await zip.generateAsync({ type: "blob", mimeType: mime, compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { name, blob, bytes: blob.size, mime };
}

/** Clone a package so the original stays untouched (JSZip mutates in place). */
export async function clonePackage(zip: JSZip): Promise<JSZip> {
  return JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
}

/* ---------- Paths & relationships ---------- */

export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/^\//, "").split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

export function dirOf(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
export function baseOf(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }

/** Resolve a relationship target relative to the part that owns the .rels. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return normalizePath(target);
  return normalizePath(`${dirOf(partPath)}/${target}`);
}

/** Relative path from one directory to a part (for writing rels targets). */
export function relativeTarget(fromPart: string, toPart: string): string {
  const from = dirOf(fromPart).split("/").filter(Boolean);
  const to = toPart.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

export function relsPathFor(partPath: string): string {
  return `${dirOf(partPath)}/_rels/${baseOf(partPath)}.rels`.replace(/^\//, "");
}
export function partPathForRels(relsPath: string): string {
  return relsPath.replace(/_rels\/([^/]+)\.rels$/, "$1");
}

export interface Rel { id: string; type: string; target: string; external: boolean; raw: string }

export function parseRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>|<Relationship\b[^>]*>[\s\S]*?<\/Relationship>/g)].map((m) => {
    const raw = m[0];
    const attr = (n: string) => raw.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? "";
    return { id: attr("Id"), type: attr("Type"), target: xmlDecode(attr("Target")), external: attr("TargetMode") === "External", raw };
  });
}

export async function readRels(zip: JSZip, partPath: string): Promise<Rel[]> {
  const xml = await readPart(zip, relsPathFor(partPath));
  return xml ? parseRels(xml) : [];
}

export function emptyRels(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
}

export function addRel(relsXml: string, id: string, type: string, target: string, external = false): string {
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${attrEncode(target)}"${external ? ' TargetMode="External"' : ""}/>`;
  return relsXml.includes("</Relationships>") ? relsXml.replace("</Relationships>", `${rel}</Relationships>`) : emptyRels().replace("</Relationships>", `${rel}</Relationships>`);
}

export function removeRel(relsXml: string, id: string): string {
  return relsXml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${escapeRe(id)}"[^>]*/>`), "").replace(new RegExp(`<Relationship\\b[^>]*\\bId="${escapeRe(id)}"[^>]*>[\\s\\S]*?</Relationship>`), "");
}

export function nextRelId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

export const REL = {
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  commentAuthors: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  coreProps: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
};

/* ---------- Content types ---------- */

export const CT_PATH = "[Content_Types].xml";

export function ctHasOverride(ct: string, partName: string): boolean {
  return ct.includes(`PartName="/${partName.replace(/^\//, "")}"`);
}
export function ctAddOverride(ct: string, partName: string, contentType: string): string {
  if (ctHasOverride(ct, partName)) return ct;
  return ct.replace("</Types>", `<Override PartName="/${partName.replace(/^\//, "")}" ContentType="${contentType}"/></Types>`);
}
export function ctRemoveOverride(ct: string, partName: string): string {
  return ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRe(partName.replace(/^\//, ""))}"[^>]*/>`), "");
}
export function ctAddDefault(ct: string, ext: string, contentType: string): string {
  if (new RegExp(`<Default\\b[^>]*Extension="${escapeRe(ext)}"`, "i").test(ct)) return ct;
  return ct.replace(/<Types[^>]*>/, (m) => `${m}<Default Extension="${ext}" ContentType="${contentType}"/>`);
}
export function ctOverrideFor(ct: string, partName: string): string | null {
  return ct.match(new RegExp(`<Override\\b[^>]*PartName="/${escapeRe(partName.replace(/^\//, ""))}"[^>]*ContentType="([^"]+)"`))?.[1]
    ?? ct.match(new RegExp(`<Override\\b[^>]*ContentType="([^"]+)"[^>]*PartName="/${escapeRe(partName.replace(/^\//, ""))}"`))?.[1] ?? null;
}

export const IMAGE_CT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", emf: "image/x-emf", wmf: "image/x-wmf", webp: "image/webp" };

/* ---------- Text inside paragraphs (shared by w: and a: namespaces) ---------- */

export interface ReplaceOptions { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }

/** Text of one paragraph: concatenated <ns:t> contents, tabs and breaks rendered. */
export function paragraphText(pXml: string, ns: "w" | "a"): string {
  const x = ns === "w"
    ? pXml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<w:cr\/>/g, "\n").replace(/<w:delText(?: [^>]*)?>[\s\S]*?<\/w:delText>/g, "")
    : pXml.replace(/<a:br\/>/g, "\n").replace(/<a:br>[\s\S]*?<\/a:br>/g, "\n");
  return xmlDecode([...x.matchAll(new RegExp(`<${ns}:t(?: [^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:t/>`, "g"))].map((m) => m[1] ?? "").join("") + (x.includes("\t") || x.includes("\n") ? "" : "")).replace(/\r/g, "");
}

/** Split XML into paragraph chunks of the given namespace, preserving everything in between. */
export function splitParagraphs(xml: string, ns: "w" | "a"): { chunks: string[]; isPara: boolean[] } {
  const re = new RegExp(`<${ns}:p(?:\\s[^>]*)?>[\\s\\S]*?</${ns}:p>`, "g");
  const chunks: string[] = []; const isPara: boolean[] = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m.index > last) { chunks.push(xml.slice(last, m.index)); isPara.push(false); }
    chunks.push(m[0]); isPara.push(true);
    last = m.index + m[0].length;
  }
  if (last < xml.length) { chunks.push(xml.slice(last)); isPara.push(false); }
  return { chunks, isPara };
}

function buildMatcher(find: string, o: ReplaceOptions): RegExp {
  let src = o.regex ? find : escapeRe(find);
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${o.caseSensitive ? "" : "i"}`);
}

/**
 * Replace text inside every paragraph, even when a match is spread across
 * several runs (Word and PowerPoint split text on spell-check and formatting
 * boundaries). The replacement takes the formatting of the run where the match
 * starts; the other runs' matched text is removed.
 */
export function replaceInXml(xml: string, ns: "w" | "a", find: string, replacement: string, o: ReplaceOptions = {}): { xml: string; count: number } {
  if (!find) return { xml, count: 0 };
  const matcher = buildMatcher(find, o);
  const { chunks, isPara } = splitParagraphs(xml, ns);
  let count = 0;
  const tRe = new RegExp(`<${ns}:t(\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:t/>`, "g");
  for (let c = 0; c < chunks.length; c++) {
    if (!isPara[c]) continue;
    const p = chunks[c];
    // Segments = text nodes in order.
    const segs: { start: number; end: number; attrs: string; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(p))) segs.push({ start: m.index, end: m.index + m[0].length, attrs: m[1] ?? "", text: m[2] == null ? "" : xmlDecode(m[2]) });
    if (!segs.length) continue;
    const full = segs.map((s) => s.text).join("");
    matcher.lastIndex = 0;
    const matches: { start: number; end: number; rep: string }[] = [];
    let mm: RegExpExecArray | null;
    // A separate non-global copy expands $1-style groups; using `matcher` itself would reset its lastIndex mid-scan.
    const expander = o.regex ? new RegExp(matcher.source, matcher.flags.replace("g", "")) : null;
    while ((mm = matcher.exec(full))) {
      if (mm[0] === "") { matcher.lastIndex++; continue; }
      matches.push({ start: mm.index, end: mm.index + mm[0].length, rep: expander ? mm[0].replace(expander, replacement) : replacement });
    }
    if (!matches.length) continue;
    count += matches.length;
    // Rebuild each segment's text: untouched characters stay in their own
    // segment, each replacement goes into the segment where its match starts.
    const starts: number[] = [];
    let acc = 0;
    for (const s of segs) { starts.push(acc); acc += s.text.length; }
    const segIndexAt = (pos: number) => { let i = 0; while (i + 1 < segs.length && starts[i + 1] <= pos) i++; return i; };
    const newTexts = segs.map(() => "");
    const copyRange = (a: number, b: number) => {
      for (let i = 0; i < segs.length && a < b; i++) {
        const s0 = starts[i], s1 = starts[i] + segs[i].text.length;
        const lo = Math.max(a, s0), hi = Math.min(b, s1);
        if (lo < hi) newTexts[i] += full.slice(lo, hi);
      }
    };
    let pos = 0;
    for (const mt of matches) {
      copyRange(pos, mt.start);
      newTexts[segIndexAt(mt.start)] += mt.rep;
      pos = mt.end;
    }
    copyRange(pos, full.length);
    let rebuilt = ""; let last = 0;
    segs.forEach((s, i) => {
      rebuilt += p.slice(last, s.start);
      const t = newTexts[i];
      const needsPreserve = ns === "w" && (/^\s|\s$/.test(t) || t === "");
      const attrs = ns === "w" ? (needsPreserve && !/xml:space/.test(s.attrs) ? `${s.attrs} xml:space="preserve"` : s.attrs) : s.attrs;
      rebuilt += `<${ns}:t${attrs}>${xmlEncode(t)}</${ns}:t>`;
      last = s.end;
    });
    rebuilt += p.slice(last);
    chunks[c] = rebuilt;
  }
  return { xml: chunks.join(""), count };
}

/** Count matches without changing anything. */
export function countInXml(xml: string, ns: "w" | "a", find: string, o: ReplaceOptions = {}): number {
  return replaceInXml(xml, ns, find, "\u0000", o).count;
}

/* ---------- Metadata ---------- */

export async function cleanMetadata(zip: JSZip, opts: { keepTitle?: boolean } = {}): Promise<string[]> {
  const removed: string[] = [];
  const core = await readPart(zip, "docProps/core.xml");
  if (core) {
    let x = core;
    for (const tag of ["dc:creator", "cp:lastModifiedBy", "cp:keywords", "dc:description", "dc:subject", "cp:category", "cp:contentStatus", "dcterms:created", "dcterms:modified", "cp:lastPrinted", "cp:revision", ...(opts.keepTitle ? [] : ["dc:title"])]) {
      const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
      if (re.test(x)) { removed.push(tag.split(":")[1]); x = x.replace(re, tag === "cp:revision" ? "<cp:revision>1</cp:revision>" : ""); }
    }
    writePart(zip, "docProps/core.xml", x);
  }
  const app = await readPart(zip, "docProps/app.xml");
  if (app) {
    let x = app;
    for (const tag of ["Company", "Manager", "TotalTime", "HyperlinkBase", "TitlesOfParts", "HeadingPairs"]) {
      const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
      if (re.test(x)) { if (!removed.includes(tag)) removed.push(tag); x = x.replace(re, tag === "TotalTime" ? "<TotalTime>0</TotalTime>" : ""); }
    }
    writePart(zip, "docProps/app.xml", x);
  }
  if (zip.file("docProps/thumbnail.jpeg") || zip.file("docProps/thumbnail.png") || zip.file("docProps/thumbnail.emf")) {
    for (const n of ["docProps/thumbnail.jpeg", "docProps/thumbnail.png", "docProps/thumbnail.emf"]) if (zip.file(n)) { zip.remove(n); removed.push("thumbnail"); }
    const root = await readPart(zip, "_rels/.rels");
    if (root) writePart(zip, "_rels/.rels", root.replace(/<Relationship\b[^>]*Target="docProps\/thumbnail\.[^"]+"[^>]*\/>/g, ""));
    const ct = await readPart(zip, CT_PATH);
    if (ct) writePart(zip, CT_PATH, ct.replace(/<Override\b[^>]*PartName="\/docProps\/thumbnail\.[^"]+"[^>]*\/>/g, ""));
  }
  if (zip.file("docProps/custom.xml")) {
    zip.remove("docProps/custom.xml"); removed.push("custom properties");
    const root = await readPart(zip, "_rels/.rels");
    if (root) writePart(zip, "_rels/.rels", root.replace(/<Relationship\b[^>]*Target="docProps\/custom\.xml"[^>]*\/>/g, ""));
    const ct = await readPart(zip, CT_PATH);
    if (ct) writePart(zip, CT_PATH, ctRemoveOverride(ct, "docProps/custom.xml"));
  }
  return [...new Set(removed)];
}

/* ---------- Media ---------- */

export interface MediaRef { path: string; bytes: number; ext: string }

export function mediaParts(zip: JSZip, folder: "ppt/media" | "word/media"): string[] {
  return Object.keys(zip.files).filter((n) => n.startsWith(folder + "/") && !zip.files[n].dir).sort();
}

export const extOf = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();

/** Images referenced by a part through its rels, resolved to package paths. */
export async function imagesOfPart(zip: JSZip, partPath: string): Promise<{ rId: string; path: string }[]> {
  const rels = await readRels(zip, partPath);
  return rels.filter((r) => r.type === REL.image && !r.external).map((r) => ({ rId: r.id, path: resolveTarget(partPath, r.target) }));
}

/* ---------- Fonts & colours ---------- */

export function replaceFont(xml: string, from: string, to: string): { xml: string; count: number } {
  let count = 0;
  const re = new RegExp(`(\\b(?:typeface|w:ascii|w:hAnsi|w:cs|w:eastAsia|w:asciiTheme)=")${escapeRe(from)}(")`, "gi");
  const out = xml.replace(re, (_, a, b) => { count++; return `${a}${attrEncode(to)}${b}`; });
  return { xml: out, count };
}

export function replaceColor(xml: string, from: string, to: string): { xml: string; count: number } {
  let count = 0;
  const f = from.replace(/^#/, "").toUpperCase(); const t = to.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(f) || !/^[0-9A-F]{6}$/.test(t)) throw new ProcessorError("Colours must be 6-digit hex like #1F3A93");
  const re = new RegExp(`(<a:srgbClr val="|<w:color w:val="|<w:shd [^>]*w:fill="|<w:top [^>]*w:color="|<w:left [^>]*w:color="|<w:bottom [^>]*w:color="|<w:right [^>]*w:color="|<a:srgbClr\\s+val=")${f}(")`, "gi");
  const out = xml.replace(re, (_, a, b) => { count++; return `${a}${t}${b}`; });
  return { xml: out, count };
}

export function fontsUsed(xml: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of xml.matchAll(/\b(?:typeface|w:ascii|w:hAnsi)="([^"]+)"/g)) map.set(m[1], (map.get(m[1]) ?? 0) + 1);
  return map;
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
}
