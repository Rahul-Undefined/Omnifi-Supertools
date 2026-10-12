import type JSZip from "jszip";
import type { FileProcessor } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName } from "@/lib/utils";
import { openPackage, readPart, writePart, savePackage, clonePackage, readRels, relsPathFor, resolveTarget, relativeTarget, parseRels, addRel, nextRelId, REL, CT_PATH, ctAddOverride, ctAddDefault, ctOverrideFor, MIME } from "../shared/ooxml";

/**
 * Append the bodies of several Word documents into the first one. Pictures,
 * charts and other embedded parts are copied with new names, relationship ids
 * are remapped, numbering definitions and footnotes are merged with offset ids,
 * and missing paragraph styles are copied so the appended text keeps its look.
 * Headers/footers come from the first document.
 */

const PART_SKIP = /^(word\/(styles|numbering|settings|webSettings|fontTable|footnotes|endnotes|comments\w*|people|glossary\/.*|header\d+|footer\d+|theme\/.*)\.xml|word\/_rels\/.*|\[Content_Types\]\.xml|_rels\/.*|docProps\/.*|customXml\/.*)$/;

function numbered(path: string): { dir: string; prefix: string; n: number; ext: string } | null {
  const m = path.match(/^(.*\/)([A-Za-z]+?)(\d+)(\.[A-Za-z0-9.]+)$/);
  return m ? { dir: m[1], prefix: m[2], n: Number(m[3]), ext: m[4] } : null;
}

function bodyInner(docXml: string): { content: string; sectPr: string } {
  const inner = docXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? "";
  const i = inner.lastIndexOf("<w:sectPr");
  return i >= 0 ? { content: inner.slice(0, i), sectPr: inner.slice(i) } : { content: inner, sectPr: "" };
}

export async function appendDocument(base: JSZip, src: JSZip, opts: { pageBreak: boolean; copyStyles: boolean }): Promise<void> {
  const baseDocPath = "word/document.xml";
  let baseDoc = (await readPart(base, baseDocPath))!;
  let baseRels = (await readPart(base, relsPathFor(baseDocPath))) ?? "";
  let ct = (await readPart(base, CT_PATH))!;
  const srcCt = (await readPart(src, CT_PATH)) ?? "";
  for (const m of srcCt.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"\/>/g)) ct = ctAddDefault(ct, m[1], m[2]);
  const srcDoc = (await readPart(src, baseDocPath)) ?? "";
  let { content } = bodyInner(srcDoc);
  const srcRels = parseRels((await readPart(src, relsPathFor(baseDocPath))) ?? "");

  // 1. Parts reachable from the source body (pictures, charts, embeddings...), renamed.
  const needed = new Set<string>();
  const visit = async (part: string) => {
    if (needed.has(part) || PART_SKIP.test(part) || !src.file(part)) return;
    needed.add(part);
    for (const r of await readRels(src, part)) if (!r.external) await visit(resolveTarget(part, r.target));
  };
  for (const r of srcRels) if (!r.external && !PART_SKIP.test(resolveTarget(baseDocPath, r.target))) await visit(resolveTarget(baseDocPath, r.target));
  const baseMax = new Map<string, number>();
  for (const p of Object.keys(base.files)) { const q = numbered(p); if (q && !p.includes("/_rels/")) baseMax.set(q.dir + q.prefix, Math.max(baseMax.get(q.dir + q.prefix) ?? 0, q.n)); }
  const map = new Map<string, string>();
  for (const p of needed) { const q = numbered(p); map.set(p, q ? `${q.dir}${q.prefix}${(baseMax.get(q.dir + q.prefix) ?? 0) + q.n}${q.ext}` : p.replace(/(\.[A-Za-z0-9]+)$/, `_${Date.now() % 100000}$1`)); }
  for (const oldPath of needed) {
    const newPath = map.get(oldPath)!;
    base.file(newPath, await src.file(oldPath)!.async("uint8array"));
    const o = ctOverrideFor(srcCt, oldPath); if (o) ct = ctAddOverride(ct, newPath, o);
    const relsXml = await readPart(src, relsPathFor(oldPath));
    if (relsXml) {
      let out = relsXml;
      for (const r of parseRels(relsXml)) {
        if (r.external) continue;
        const t = resolveTarget(oldPath, r.target);
        if (map.has(t)) out = out.replace(r.raw, r.raw.replace(/Target="[^"]*"/, `Target="${relativeTarget(newPath, map.get(t)!)}"`));
        else out = out.replace(r.raw, "");
      }
      base.file(relsPathFor(newPath), out);
    }
  }

  // 2. Relationship ids used by the body: remap into the base document rels.
  const idMap = new Map<string, string>();
  for (const r of srcRels) {
    const t = r.external ? "" : resolveTarget(baseDocPath, r.target);
    if (r.external) { const nid = nextRelId(baseRels); baseRels = addRel(baseRels, nid, r.type, r.target, true); idMap.set(r.id, nid); }
    else if (map.has(t)) { const nid = nextRelId(baseRels); baseRels = addRel(baseRels, nid, r.type, relativeTarget(baseDocPath, map.get(t)!)); idMap.set(r.id, nid); }
  }
  content = content.replace(/\b(r:id|r:embed|r:link|r:pict)="([^"]+)"/g, (m, attr, id) => (idMap.has(id) ? `${attr}="${idMap.get(id)}"` : m));
  // Section breaks inside the appended body must not point at the source's headers/footers.
  content = content.replace(/<w:(headerReference|footerReference)\b[^>]*\/>/g, "");
  // Comments are not carried over.
  content = content.replace(/<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>/g, "").replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>[\s\S]*?<\/w:r>/g, "");

  // 3. Numbering: merge definitions with offset ids.
  const srcNum = await readPart(src, "word/numbering.xml");
  if (srcNum) {
    const baseNum = await readPart(base, "word/numbering.xml");
    if (!baseNum) {
      base.file("word/numbering.xml", srcNum);
      ct = ctAddOverride(ct, "word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml");
      if (!parseRels(baseRels).some((r) => r.type === REL.numbering)) baseRels = addRel(baseRels, nextRelId(baseRels), REL.numbering, "numbering.xml");
    } else {
      const absOff = Math.max(0, ...[...baseNum.matchAll(/w:abstractNumId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
      const numOff = Math.max(0, ...[...baseNum.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
      const abstracts = [...srcNum.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)].map((m) => m[0].replace(/w:abstractNumId="(\d+)"/, (_, n) => `w:abstractNumId="${Number(n) + absOff}"`).replace(/<w:nsid w:val="[^"]*"\/>/, "").replace(/<w:tmpl w:val="[^"]*"\/>/, ""));
      const nums = [...srcNum.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g)].map((m) => m[0].replace(/w:numId="(\d+)"/, (_, n) => `w:numId="${Number(n) + numOff}"`).replace(/<w:abstractNumId w:val="(\d+)"\/>/, (_, n) => `<w:abstractNumId w:val="${Number(n) + absOff}"/>`));
      let merged = baseNum;
      const lastAbs = merged.lastIndexOf("</w:abstractNum>");
      merged = lastAbs >= 0 ? merged.slice(0, lastAbs + 16) + abstracts.join("") + merged.slice(lastAbs + 16) : merged.replace(/(<w:numbering\b[^>]*>)/, `$1${abstracts.join("")}`);
      merged = merged.replace("</w:numbering>", `${nums.join("")}</w:numbering>`);
      base.file("word/numbering.xml", merged);
      content = content.replace(/<w:numId w:val="(\d+)"\/>/g, (_, n) => `<w:numId w:val="${Number(n) + numOff}"/>`);
    }
  }

  // 4. Footnotes / endnotes.
  for (const kind of ["footnotes", "endnotes"] as const) {
    const tag = kind === "footnotes" ? "footnote" : "endnote";
    const srcPart = await readPart(src, `word/${kind}.xml`);
    if (!srcPart || !new RegExp(`<w:${tag}Reference\\b`).test(content)) continue;
    const basePart = await readPart(base, `word/${kind}.xml`);
    if (!basePart) {
      base.file(`word/${kind}.xml`, srcPart);
      ct = ctAddOverride(ct, `word/${kind}.xml`, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`);
      if (!parseRels(baseRels).some((r) => r.type.endsWith(`/${kind}`))) baseRels = addRel(baseRels, nextRelId(baseRels), `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`, `${kind}.xml`);
    } else {
      const off = Math.max(0, ...[...basePart.matchAll(new RegExp(`<w:${tag}\\b[^>]*w:id="(-?\\d+)"`, "g"))].map((m) => Number(m[1]))) + 1;
      const notes = [...srcPart.matchAll(new RegExp(`<w:${tag}\\b[^>]*w:id="([1-9]\\d*)"[\\s\\S]*?</w:${tag}>`, "g"))].map((m) => m[0].replace(/w:id="(\d+)"/, (_, n) => `w:id="${Number(n) + off}"`));
      base.file(`word/${kind}.xml`, basePart.replace(`</w:${kind}>`, `${notes.join("")}</w:${kind}>`));
      content = content.replace(new RegExp(`(<w:${tag}Reference\\b[^>]*w:id=")(\\d+)(")`, "g"), (_, a, n, c) => `${a}${Number(n) + off}${c}`);
    }
  }

  // 5. Styles the appended text uses but the base lacks.
  if (opts.copyStyles) {
    const srcStyles = await readPart(src, "word/styles.xml");
    const baseStyles = await readPart(base, "word/styles.xml");
    if (srcStyles && baseStyles) {
      const have = new Set([...baseStyles.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]));
      const used = new Set([...content.matchAll(/<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"/g)].map((m) => m[1]));
      const add: string[] = [];
      const pull = (id: string) => {
        if (have.has(id)) return;
        const m = srcStyles.match(new RegExp(`<w:style\\b[^>]*w:styleId="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</w:style>`));
        if (!m) return;
        have.add(id); add.push(m[0]);
        for (const dep of m[0].matchAll(/<w:(?:basedOn|next|link) w:val="([^"]+)"/g)) pull(dep[1]);
      };
      for (const id of used) pull(id);
      if (add.length) base.file("word/styles.xml", baseStyles.replace("</w:styles>", `${add.join("")}</w:styles>`));
    }
  }

  // 6. Unique ids for drawings and bookmarks.
  const docPrMax = Math.max(0, ...[...baseDoc.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])));
  content = content.replace(/(<wp:docPr\b[^>]*\bid=")(\d+)(")/g, (_, a, n, c) => `${a}${Number(n) + docPrMax + 1}${c}`);
  const bmMax = Math.max(0, ...[...baseDoc.matchAll(/<w:bookmark(?:Start|End)\b[^>]*w:id="(\d+)"/g)].map((m) => Number(m[1])));
  content = content.replace(/(<w:bookmark(?:Start|End)\b[^>]*w:id=")(\d+)(")/g, (_, a, n, c) => `${a}${Number(n) + bmMax + 1}${c}`);

  // 7. Append before the final sectPr.
  const { content: baseContent, sectPr } = bodyInner(baseDoc);
  const sep = opts.pageBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
  baseDoc = baseDoc.replace(/<w:body>[\s\S]*<\/w:body>/, () => `<w:body>${baseContent}${sep}${content}${sectPr}</w:body>`);
  writePart(base, baseDocPath, baseDoc);
  writePart(base, relsPathFor(baseDocPath), baseRels);
  writePart(base, CT_PATH, ct);
}

export const mergeDocs: FileProcessor = async (files, { options, onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two Word documents", "They are appended in the order shown; the first document's page setup, headers and footers are used.");
  const base = await clonePackage(await openPackage(files[0], "docx"));
  for (let i = 1; i < files.length; i++) {
    throwIfAborted(signal);
    await appendDocument(base, await openPackage(files[i], "docx"), { pageBreak: options.pageBreak !== false, copyStyles: options.copyStyles !== false });
    onProgress?.(i / files.length, files[i].name);
  }
  const name = String(options.name ?? "").trim().replace(/\.docx$/i, "");
  const out = await savePackage(base, `${name || `${baseName(files[0].name)}-merged`}.docx`, MIME.docx);
  return { files: [out], stats: { Documents: String(files.length), Size: `${Math.round(out.bytes / 1024)} KB` }, warnings: ["Headers, footers and page setup come from the first document. Comments are not carried over; tracked changes are kept as they are."] };
};
