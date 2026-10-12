import JSZip from "jszip";
import type { FileProcessor } from "@/types/processor";
import { ProcessorError, throwIfAborted } from "@/types/processor";
import { baseName } from "@/lib/utils";
import { openPackage, readPart, writePart, savePackage, clonePackage, readRels, relsPathFor, resolveTarget, relativeTarget, parseRels, addRel, nextRelId, REL, CT_PATH, ctAddOverride, ctAddDefault, ctOverrideFor, MIME, escapeRe } from "../shared/ooxml";
import { listSlides } from "./index";
import { parsePageRanges } from "../shared/pages";

/**
 * Append slides from other decks into the first deck. Every part the slides
 * depend on (layouts, masters, themes, pictures, charts, notes) is copied with
 * renumbered part names so nothing collides, and all relationships are
 * rewritten. Slides keep their original design because their own master and
 * layout travel with them.
 */

const SKIP = /^(ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|ppt\/presProps\.xml|ppt\/viewProps\.xml|ppt\/tableStyles\.xml|ppt\/commentAuthors\.xml|ppt\/authors\.xml|ppt\/revisionInfo\.xml|ppt\/changesInfos\/.*|ppt\/comments\/.*|ppt\/handoutMasters\/.*|ppt\/notesMasters\/.*|ppt\/_rels\/.*|\[Content_Types\]\.xml|_rels\/.*|docProps\/.*|customXml\/.*)$/;

function numbered(path: string): { dir: string; prefix: string; n: number; ext: string } | null {
  const m = path.match(/^(.*\/)([A-Za-z]+?)(\d+)(\.[A-Za-z0-9.]+)$/);
  return m ? { dir: m[1], prefix: m[2], n: Number(m[3]), ext: m[4] } : null;
}

export async function mergeInto(base: JSZip, src: JSZip, keepIndices: number[] | null): Promise<number> {
  const srcSlides = await listSlides(src);
  const chosen = keepIndices ? srcSlides.filter((s) => keepIndices.includes(s.index)) : srcSlides;
  if (!chosen.length) return 0;

  // Which parts to copy: everything reachable from the chosen slides, plus their masters' themes etc.
  const needed = new Set<string>();
  const visit = async (part: string) => {
    if (needed.has(part) || SKIP.test(part)) return;
    if (!src.file(part)) return;
    needed.add(part);
    for (const r of await readRels(src, part)) {
      if (r.external) continue;
      const t = resolveTarget(part, r.target);
      if (SKIP.test(t)) continue;
      await visit(t);
    }
  };
  for (const s of chosen) await visit(s.path);

  // Part-name mapping with per-(dir,prefix) offsets based on what base already has.
  const baseMax = new Map<string, number>();
  for (const p of Object.keys(base.files)) { const q = numbered(p); if (q && !p.includes("/_rels/")) { const k = q.dir + q.prefix; baseMax.set(k, Math.max(baseMax.get(k) ?? 0, q.n)); } }
  const srcMax = new Map<string, number>();
  const map = new Map<string, string>();
  for (const p of needed) {
    const q = numbered(p);
    if (!q) { map.set(p, p.replace(/(\.[A-Za-z0-9]+)$/, `_m${Date.now() % 100000}$1`)); continue; }
    const k = q.dir + q.prefix;
    srcMax.set(k, Math.max(srcMax.get(k) ?? 0, q.n));
  }
  for (const p of needed) {
    const q = numbered(p);
    if (!q) continue;
    const k = q.dir + q.prefix;
    map.set(p, `${q.dir}${q.prefix}${(baseMax.get(k) ?? 0) + q.n}${q.ext}`);
  }

  let ct = (await readPart(base, CT_PATH))!;
  const srcCt = (await readPart(src, CT_PATH)) ?? "";
  for (const m of srcCt.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"\/>/g)) ct = ctAddDefault(ct, m[1], m[2]);

  // Base notes master (for copied notes slides).
  const baseNotesMaster = Object.keys(base.files).find((p) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(p));
  const srcNotesMaster = Object.keys(src.files).find((p) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(p));
  let notesMasterTarget: string | null = baseNotesMaster ?? null;
  let presRels = (await readPart(base, relsPathFor("ppt/presentation.xml")))!;
  let pres = (await readPart(base, "ppt/presentation.xml"))!;
  if (!notesMasterTarget && srcNotesMaster && [...needed].some((p) => p.startsWith("ppt/notesSlides/"))) {
    // Copy the source notes master (+ its theme) so the notes pages keep working.
    const nmNew = "ppt/notesMasters/notesMaster1.xml";
    const nmXml = (await readPart(src, srcNotesMaster))!;
    const nmRels = parseRels((await readPart(src, relsPathFor(srcNotesMaster))) ?? "");
    let newRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    for (const r of nmRels) {
      if (r.external) { newRels = addRel(newRels, r.id, r.type, r.target, true); continue; }
      const t = resolveTarget(srcNotesMaster, r.target);
      if (r.type === REL.theme) {
        const q = numbered(t)!; const k = q.dir + q.prefix;
        const themeNew = `${q.dir}${q.prefix}${(baseMax.get(k) ?? 0) + (srcMax.get(k) ?? 0) + 1}${q.ext}`;
        base.file(themeNew, await src.file(t)!.async("uint8array"));
        ct = ctAddOverride(ct, themeNew, ctOverrideFor(srcCt, t) ?? "application/vnd.openxmlformats-officedocument.theme+xml");
        newRels = addRel(newRels, r.id, r.type, relativeTarget(nmNew, themeNew));
      } else newRels = addRel(newRels, r.id, r.type, r.target);
    }
    base.file(nmNew, nmXml);
    base.file(relsPathFor(nmNew), newRels);
    ct = ctAddOverride(ct, nmNew, ctOverrideFor(srcCt, srcNotesMaster) ?? "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml");
    const rid = nextRelId(presRels);
    presRels = addRel(presRels, rid, REL.notesMaster, "notesMasters/notesMaster1.xml");
    const lst = `<p:notesMasterIdLst><p:notesMasterId r:id="${rid}"/></p:notesMasterIdLst>`;
    pres = /<p:notesMasterIdLst>/.test(pres) ? pres : pres.replace(/(<\/p:sldMasterIdLst>)/, `$1${lst}`);
    notesMasterTarget = nmNew;
  }

  // Unique ids for layouts/masters/slides.
  const allIds = [...pres.matchAll(/\bid="(\d+)"/g)].map((m) => Number(m[1]));
  for (const p of Object.keys(base.files).filter((x) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(x))) for (const m of ((await readPart(base, p)) ?? "").matchAll(/<p:sldLayoutId\b[^>]*\bid="(\d+)"/g)) allIds.push(Number(m[1]));
  let nextBigId = Math.max(2147483648, ...allIds.filter((n) => n >= 2147483648)) + 1;
  let nextSlideId = Math.max(255, ...allIds.filter((n) => n < 2147483648)) + 1;

  // Copy parts with rewritten rels.
  for (const oldPath of needed) {
    const newPath = map.get(oldPath)!;
    const file = src.file(oldPath)!;
    if (/\.xml$/.test(oldPath)) {
      let xml = await file.async("string");
      if (/^ppt\/slideMasters\//.test(oldPath)) xml = xml.replace(/(<p:sldLayoutId\b[^>]*\bid=")(\d+)(")/g, (_, a, __, c) => `${a}${nextBigId++}${c}`);
      base.file(newPath, xml);
    } else base.file(newPath, await file.async("uint8array"));
    const o = ctOverrideFor(srcCt, oldPath);
    if (o) ct = ctAddOverride(ct, newPath, o);
    const relsXml = await readPart(src, relsPathFor(oldPath));
    if (relsXml) {
      let out = relsXml;
      for (const r of parseRels(relsXml)) {
        if (r.external) continue;
        const t = resolveTarget(oldPath, r.target);
        let replacement: string | null = null;
        if (r.type === REL.notesMaster) replacement = notesMasterTarget ? relativeTarget(newPath, notesMasterTarget) : null;
        else if (map.has(t)) replacement = relativeTarget(newPath, map.get(t)!);
        else if (SKIP.test(t)) replacement = null;
        if (replacement) out = out.replace(r.raw, r.raw.replace(/Target="[^"]*"/, `Target="${replacement}"`));
        else out = out.replace(r.raw, "");
      }
      base.file(relsPathFor(newPath), out);
    }
  }

  // Register masters and slides with the presentation.
  for (const oldPath of needed) {
    if (!/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(oldPath)) continue;
    const rid = nextRelId(presRels);
    presRels = addRel(presRels, rid, REL.slideMaster, relativeTarget("ppt/presentation.xml", map.get(oldPath)!));
    pres = pres.replace(/<\/p:sldMasterIdLst>/, `<p:sldMasterId id="${nextBigId++}" r:id="${rid}"/></p:sldMasterIdLst>`);
  }
  let added = 0;
  for (const s of chosen) {
    const rid = nextRelId(presRels);
    presRels = addRel(presRels, rid, REL.slide, relativeTarget("ppt/presentation.xml", map.get(s.path)!));
    pres = pres.replace(/<\/p:sldIdLst>/, `<p:sldId id="${nextSlideId++}" r:id="${rid}"/></p:sldIdLst>`);
    added++;
  }
  writePart(base, "ppt/presentation.xml", pres);
  writePart(base, relsPathFor("ppt/presentation.xml"), presRels);
  writePart(base, CT_PATH, ct);
  const app = await readPart(base, "docProps/app.xml");
  if (app) writePart(base, "docProps/app.xml", app.replace(/<Slides>\d+<\/Slides>/, (m) => `<Slides>${Number(m.match(/\d+/)![0]) + added}</Slides>`).replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, "").replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, ""));
  return added;
}

export const mergeDecks: FileProcessor = async (files, { options, onProgress, signal }) => {
  if (files.length < 2) throw new ProcessorError("Add at least two decks", "The first deck's size and settings are used; slides from the others are appended in order.");
  const rangeSpecs = String(options.ranges ?? "").split(";").map((s) => s.trim()).map((s) => (/^(all|\*)$/i.test(s) ? "" : s));
  const base = await clonePackage(await openPackage(files[0], "pptx"));
  const baseSlides = await listSlides(base);
  let total = baseSlides.length;
  if (rangeSpecs[0]) {
    const { keepSlides } = await import("./index");
    const keep = new Set(parsePageRanges(rangeSpecs[0], baseSlides.length));
    const trimmed = await keepSlides(base, baseSlides, keep);
    const bytes = await trimmed.generateAsync({ type: "uint8array" });
    const reopened = await JSZip.loadAsync(bytes);
    total = keep.size;
    // continue with the trimmed base
    for (const k of Object.keys(base.files)) base.remove(k);
    for (const [k, f] of Object.entries(reopened.files)) if (!f.dir) base.file(k, await f.async("uint8array"));
  }
  for (let i = 1; i < files.length; i++) {
    throwIfAborted(signal);
    const src = await openPackage(files[i], "pptx");
    const n = (await listSlides(src)).length;
    const keep = rangeSpecs[i] ? parsePageRanges(rangeSpecs[i], n) : null;
    total += await mergeInto(base, src, keep);
    onProgress?.(i / files.length, files[i].name);
  }
  const out = await savePackage(base, String(options.name ?? "").trim().replace(/\.pptx$/i, "") ? `${String(options.name).trim().replace(/\.pptx$/i, "")}.pptx` : `${baseName(files[0].name)}-merged.pptx`, MIME.pptx);
  const sizes = await Promise.all(files.map(async (f) => ((await readPart(await openPackage(f, "pptx"), "ppt/presentation.xml")) ?? "").match(/<p:sldSz cx="(\d+)" cy="(\d+)"/)?.slice(1, 3).join("x")));
  const warnings: string[] = [];
  if (new Set(sizes).size > 1) warnings.push("The decks use different slide sizes; appended slides keep their own layout but are shown at the first deck's size (PowerPoint scales them).");
  return { files: [out], stats: { Decks: String(files.length), Slides: String(total) }, warnings };
};

export const _escape = escapeRe;
