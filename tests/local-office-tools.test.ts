import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { ProcessorFile } from "../src/types/processor";
import * as pptx from "../src/processors/pptx";
import * as docx from "../src/processors/docx";

/**
 * Local-only harness: runs the PowerPoint and Word processors on real files
 * from this machine (paths in OFFICE_PPTX / OFFICE_DOCX) and writes every
 * output to OFFICE_OUT for validation with the real Office applications.
 * Skipped unless those variables are set. Nothing here is committed as data.
 */
const out = process.env.OFFICE_OUT;
const pptxPath = process.env.OFFICE_PPTX;
const docxPath = process.env.OFFICE_DOCX;
const ok = Boolean(out && pptxPath && docxPath && existsSync(pptxPath!) && existsSync(docxPath!));

const load = (p: string, type: string) => new File([readFileSync(p)], path.basename(p), { type });
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function dump(prefix: string, files: ProcessorFile[]) {
  for (const f of files) writeFileSync(path.join(out!, `${prefix}__${f.name.replace(/[\\/]/g, "_")}`), new Uint8Array(await f.blob.arrayBuffer()));
}
const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

describe.skipIf(!ok)("PowerPoint tools on a real deck", () => {
  it("runs the non-canvas processors", async () => {
    mkdirSync(out!, { recursive: true });
    const deck = load(pptxPath!, PPTX);
    const deck2 = new File([readFileSync(pptxPath!)], "second.pptx", { type: PPTX });
    const r1 = await pptx.extractText([deck], ctx({ format: "md" })); await dump("ppt-text", r1.files); expect(r1.text).toBeTruthy();
    const r1b = await pptx.extractText([deck], ctx({ format: "docx" })); await dump("ppt-text", r1b.files);
    const r2 = await pptx.extractImages([deck], ctx()).catch((e) => ({ files: [], text: String(e) })); await dump("ppt-images", r2.files);
    const r5 = await pptx.notesDocument([deck], ctx()); await dump("ppt-notes", r5.files);
    const r6 = await pptx.mergeDecks([deck, deck2], ctx({ ranges: "all; 1-2" })); await dump("ppt-merge", r6.files); expect(r6.stats?.Slides).toBeTruthy();
    const r7 = await pptx.splitDeck([deck], ctx({ mode: "extract", ranges: "1-2" })); await dump("ppt-split", r7.files);
    const r7b = await pptx.splitDeck([deck], ctx({ mode: "chunks", every: 3 })); await dump("ppt-chunks", r7b.files);
    const r8 = await pptx.findReplace([deck], ctx({ pairs: "the => THE", caseSensitive: true })); await dump("ppt-replace", r8.files);
    const r9 = await pptx.fontColor([deck], ctx({ fontFrom: "Calibri", fontTo: "Arial", colorFrom: "#000000", colorTo: "#112233" })); await dump("ppt-font", r9.files);
    const r10 = await pptx.cleanCopy([deck], ctx()); await dump("ppt-clean", r10.files); expect(r10.text).toBeTruthy();
    const r17 = await pptx.audit([deck], ctx()); await dump("ppt-audit", r17.files); expect(r17.text).toBeTruthy();
    const r18 = await pptx.compare([deck, deck2], ctx()); await dump("ppt-compare", r18.files);
    const r14 = await pptx.fromMarkdown("# Deck\n\n## One\n- a\n- b\n\n## Two\n| x | y |\n| - | - |\n| 1 | 2 |", ctx()); await dump("ppt-md", r14.files);
    const r15 = await pptx.agenda("Results | Revenue and margin\nPeople\nRisks | Top 3", ctx({ title: "MBR" })); await dump("ppt-agenda", r15.files);
    const csv = new File(["Name,Q1,Q2\nAcme,10,12\nGlobex,7,9\n"], "data.csv", { type: "text/csv" });
    const r13 = await pptx.fromSpreadsheet([csv], ctx({ mode: "rows" })); await dump("ppt-sheet", r13.files);
    const r13b = await pptx.fromSpreadsheet([csv], ctx({ mode: "table" })); await dump("ppt-sheet-table", r13b.files);
  }, 120000);
});

describe.skipIf(!ok)("Word tools on a real document", () => {
  it("runs the non-canvas processors", async () => {
    mkdirSync(out!, { recursive: true });
    const doc = load(docxPath!, DOCX);
    const doc2 = new File([readFileSync(docxPath!)], "second.docx", { type: DOCX });
    const r1 = await docx.extractText([doc], ctx({ format: "md", headers: true })); await dump("doc-text", r1.files); expect(r1.text).toBeTruthy();
    const r16 = await docx.tablesToExcel([doc], ctx()).catch((e) => ({ files: [], text: String(e) })); await dump("doc-tables", r16.files);
    const r2 = await docx.extractImages([doc], ctx()).catch((e) => ({ files: [], text: String(e) })); await dump("doc-images", r2.files);
    const r3 = await docx.mergeDocs([doc, doc2], ctx()); await dump("doc-merge", r3.files);
    const r4 = await docx.splitDoc([doc], ctx({ mode: "heading", level: 2 })).catch((e) => ({ files: [], text: String(e) })); await dump("doc-split", r4.files);
    const r5 = await docx.findReplace([doc], ctx({ pairs: "the => THE", caseSensitive: true })); await dump("doc-replace", r5.files);
    const r6 = await docx.fontColor([doc], ctx({ fontFrom: "Calibri", fontTo: "Arial", colorFrom: "#000000", colorTo: "#112233" })); await dump("doc-font", r6.files);
    const r7 = await docx.cleanCopy([doc], ctx({ hidden: true })); await dump("doc-clean", r7.files);
    const r7b = await docx.acceptChanges([doc], ctx()); await dump("doc-accept", r7b.files);
    const r13 = await docx.audit([doc], ctx()); await dump("doc-audit", r13.files); expect(r13.text).toBeTruthy();
    const r14 = await docx.compare([doc, doc2], ctx()); await dump("doc-compare", r14.files);
    const r17 = await docx.headerFooter([doc], ctx({ header: "CONFIDENTIAL", footer: "Draft", pageNumbers: true })); await dump("doc-stamp", r17.files);
    const r10 = await docx.fromMarkdown("# Title\n\nSome **bold** and *italic* text with `code` and a [link](https://www.myomnifi.com/).\n\n## List\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quote\n\n```\ncode block\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |", ctx()); await dump("doc-md", r10.files);
    const csv = new File(["Client,Amount,Due\nAcme,\"1,200\",2026-11-01\nGlobex,900,2026-11-15\n"], "data.csv", { type: "text/csv" });
    const r11 = await docx.fromSpreadsheet([csv], ctx({ mode: "table" })); await dump("doc-sheet", r11.files);
    const r11b = await docx.fromSpreadsheet([csv], ctx({ mode: "sections" })); await dump("doc-sheet-sections", r11b.files);
    // Mail merge with a generated template.
    const tpl = await docx.fromMarkdown("# Invoice reminder\n\nDear {{Client}},\n\nYour balance of {{Amount}} is due on {{Due}}.", ctx());
    const tplFile = new File([await tpl.files[0].blob.arrayBuffer()], "template.docx", { type: DOCX });
    const r12 = await docx.mailMerge([tplFile, csv], ctx()); await dump("doc-mailmerge", r12.files); expect(r12.stats?.Documents).toBe("2");
  }, 120000);
});
