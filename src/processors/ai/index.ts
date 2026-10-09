import type { FileProcessor, TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { fileFromText } from "../shared/output";
import { baseName } from "@/lib/utils";

/**
 * AI processors post to /api/ai/run. The server holds provider credentials;
 * the browser only ever sees the result. Files are read to text in the
 * browser first (PDF, DOCX, TXT) so raw documents never leave the machine
 * unless they are scanned images (which are sent for OCR-free extraction).
 */
async function run(task: string, input: string, options: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; model: string; usage?: { input: number; output: number } }> {
  const res = await fetch("/api/ai/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, input, options }), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProcessorError(data.error ?? `AI request failed (${res.status})`, data.hint);
  return data;
}

function finish(task: string, r: { text: string; model: string; usage?: { input: number; output: number } }, ext = "txt") {
  const stats: Record<string, string> = { Model: r.model };
  if (r.usage) stats.Tokens = `${r.usage.input.toLocaleString()} in / ${r.usage.output.toLocaleString()} out`;
  const mime = ext === "json" ? "application/json" : ext === "csv" ? "text/csv" : "text/plain";
  return { files: [fileFromText(`${task}.${ext}`, r.text, mime)], text: r.text, stats };
}

const textTask = (task: string, ext = "txt"): TextProcessor => async (input, { options, signal }) => {
  if (!input.trim() && !["regexAssistant", "sqlAssistant", "excelFormula"].includes(task)) throw new ProcessorError("Enter some text first");
  return finish(task, await run(task, input, options, signal), ext);
};

export const summarize = textTask("summarize");
export const actionItems = textTask("actionItems");
export const extractStructured = textTask("extractStructured", "json");
export const extractTables = textTask("extractTables", "csv");
export const translate = textTask("translate");
export const rewrite = textTask("rewrite");
export const proofread = textTask("proofread");
export const meetingNotes = textTask("meetingNotes");
export const compareDocs = textTask("compareDocs");
export const textToJson = textTask("textToJson", "json");
export const regexAssistant = textTask("regexAssistant");
export const sqlAssistant = textTask("sqlAssistant");
export const codeExplain = textTask("codeExplain");
export const excelFormula = textTask("excelFormula");
export const aiDetect = textTask("aiDetect");

/** Read a document to text in the browser. */
async function fileToText(file: File, onProgress?: (f: number, l?: string) => void): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") {
    const pdf = await import("../pdf");
    const r = await pdf.extractText([file], { options: {}, onProgress });
    if ((r.text ?? "").trim().length < 20) {
      onProgress?.(0.3, "No text layer, running OCR");
      const o = await pdf.ocr([file], { options: { lang: "eng", scale: 2 }, onProgress });
      return o.text ?? "";
    }
    return r.text ?? "";
  }
  if (ext === "docx") {
    const office = await import("../office");
    return (await office.docxText([file], { options: {} })).text ?? "";
  }
  if (file.type.startsWith("image/")) {
    const pdf = await import("../pdf");
    return (await pdf.ocr([file], { options: { lang: "eng" }, onProgress })).text ?? "";
  }
  return file.text();
}

const fileTask = (task: string, ext = "txt"): FileProcessor => async (files, { options, onProgress, signal }) => {
  if (!files.length) throw new ProcessorError("Add a document");
  const outputs = [];
  let all = "";
  for (let i = 0; i < files.length; i++) {
    const text = await fileToText(files[i], (f, l) => onProgress?.((i + f * 0.5) / files.length, l));
    if (!text.trim()) throw new ProcessorError(`No readable text in ${files[i].name}`);
    onProgress?.((i + 0.6) / files.length, "Sending to AI");
    const r = await run(task, text.slice(0, 400_000), { ...options, fileName: files[i].name }, signal);
    const out = finish(task, r, ext);
    out.files[0].name = `${baseName(files[i].name)}-${task}.${ext}`;
    outputs.push(...out.files);
    all += (files.length > 1 ? `===== ${files[i].name} =====\n` : "") + r.text + "\n\n";
    onProgress?.((i + 1) / files.length);
  }
  return { files: outputs, text: all.trim() };
};

export const summarizeFile = fileTask("summarize");
export const documentQa = fileTask("documentQa");
export const invoiceExtract = fileTask("invoiceExtract", "json");
