import Fuse from "fuse.js";
import { tools, accepts } from "@/tools/registry";
import { categoryById } from "@/tools/categories";
import type { ToolDefinition } from "@/types/tool";

/**
 * Tool search that copes with plain sentences ("i want to convert image into pdf").
 * 1. Phrase synonyms give a strong boost for known phrasings.
 * 2. Filler words are dropped and everyday words expanded to the formats tools use.
 * 3. "X to/into Y" is read as a conversion: X matched against inputs, Y against outputs.
 * 4. Remaining tokens are scored against name, keywords, description, inputs and outputs.
 * 5. Fuse.js fuzzy matching fills in typos and partial words.
 */

/** Common phrasings that should land on a specific tool. */
const synonyms: Record<string, string[]> = {
  "mp4 to mp3": ["extract-audio"],
  "extract text from a scanned document": ["ocr-pdf"],
  "scanned": ["ocr-pdf"],
  "edit pdf": ["pdf-editor"],
  "annotate": ["pdf-editor"],
  "epub": ["pdf-to-epub"],
  "number to words": ["number-to-words"],
  "amount in words": ["number-to-words"],
  "timesheet": ["time-decimal"],
  "decimal hours": ["time-decimal"],
  "csv to json": ["csv-to-json"],
  "json to csv": ["json-to-csv"],
  "find and replace": ["find-replace", "docx-find-replace", "pptx-find-replace"],
  "transparent": ["color-to-transparent", "image-opacity"],
  "hidden characters": ["hidden-characters"],
  "merge powerpoint": ["pptx-merge"],
  "combine decks": ["pptx-merge"],
  "merge word": ["docx-merge"],
  "combine word": ["docx-merge"],
  "mail merge": ["docx-mail-merge"],
  "letters from excel": ["docx-mail-merge"],
  "speaker notes": ["pptx-notes-document", "pptx-text-extractor"],
  "handout": ["pptx-handout"],
  "accept all changes": ["docx-accept-changes", "docx-clean-copy"],
  "tracked changes": ["docx-accept-changes", "docx-clean-copy", "docx-audit"],
  "remove comments": ["docx-clean-copy", "pptx-clean-copy"],
  "page numbers word": ["docx-header-footer"],
  "confidential": ["docx-header-footer", "watermark-pdf"],
  "rebrand": ["pptx-font-color", "docx-font-color"],
  "change font": ["pptx-font-color", "docx-font-color"],
  "agenda": ["pptx-agenda"],
  "chart slide": ["csv-to-chart-slide"],
  "excel to csv": ["excel-to-csv"],
  "csv to excel": ["csv-to-excel"],
  "compare two excel files": ["excel-compare"],
  "qr": ["qr-generator", "qr-reader"],
  "shrink": ["compress-pdf", "compress-image"],
  "smaller": ["compress-pdf", "compress-image", "video-compressor"],
  "unzip": ["zip-extractor"],
  "json": ["json-formatter", "json-validator", "json-minifier"],
  "sales tax": ["sales-tax-calculator"],
  "loan": ["loan-payment-calculator", "loan-amortization"],
  "mortgage": ["loan-payment-calculator", "loan-amortization"],
  "typing": ["typing-test"],
  "wpm": ["typing-test"],
  "base32": ["base32-base58"],
  "base58": ["base32-base58"],
  "aging": ["ar-aging"],
  "reconcil": ["bank-reconciliation"],
  "redact": ["redact-pdf", "redact-pdf-text"],
  "written by ai": ["ai-writing-check", "ai-writing-second-opinion"],
  "ai detector": ["ai-writing-check", "ai-writing-second-opinion"],
  "chatgpt": ["ai-writing-check"],
  "plagiar": ["similarity-check"],
  "password": ["password-tool", "protect-pdf", "unlock-pdf"],
  "invoice": ["invoice-generator", "invoice-extractor", "ar-aging"],
  "read aloud": ["text-to-speech"],
  "dictat": ["dictation"],
  "reorder": ["organize-pdf"],
  "rearrange": ["organize-pdf"],
  "fill form": ["fill-pdf-form"],
  "signature": ["sign-pdf"],
  "miles to": ["unit-converter"],
  "to km": ["unit-converter"],
  "fiscal": ["date-math"],
  "days between": ["date-math"],
  "split statement": ["statement-splitter", "split-pdf-smart"],
  "bank": ["bank-statement-cleaner", "bank-statement-to-excel"],
  "ist to": ["timezone-converter"],
  "to est": ["timezone-converter"],
  "time zone": ["timezone-converter", "world-clock"],
  "timezone": ["timezone-converter", "world-clock"],
  "usd to": ["currency-converter"],
  "to inr": ["currency-converter"],
  "exchange rate": ["currency-converter"],
  "word to pdf": ["docx-to-pdf"],
  "excel to pdf": ["excel-to-pdf"],
  "image to pdf": ["jpg-to-pdf", "image-to-pdf"],
  "picture to pdf": ["jpg-to-pdf", "image-to-pdf"],
  "photo to pdf": ["jpg-to-pdf", "image-to-pdf"],
  "pdf to image": ["pdf-to-jpg", "pdf-to-image"],
  "meeting notes": ["ai-meeting-notes"],
  "summar": ["ai-summarize", "ai-document-summarizer", "summarize-pdf"],
  "translate": ["ai-translate"],
};

/** Words that carry no meaning for finding a tool. */
const STOP = new Set("i want to need would like please can you could help me my a an the this that these those some of for with into in on at from and or is are be do does it its file files one tool tools something make get turn change convert converting conversion how way".split(" "));

/** Everyday words -> format/keyword tokens that tools actually use. */
const EXPAND: Record<string, string[]> = {
  image: ["image", "jpg", "jpeg", "png", "webp"],
  images: ["image", "jpg", "jpeg", "png", "webp"],
  picture: ["image", "jpg", "jpeg", "png"],
  pictures: ["image", "jpg", "jpeg", "png"],
  photo: ["image", "jpg", "jpeg", "png"],
  photos: ["image", "jpg", "jpeg", "png"],
  pic: ["image", "jpg", "png"],
  screenshot: ["image", "png"],
  jpg: ["jpg", "jpeg", "image"],
  jpeg: ["jpg", "jpeg", "image"],
  png: ["png", "image"],
  spreadsheet: ["xlsx", "excel", "csv"],
  spreadsheets: ["xlsx", "excel", "csv"],
  excel: ["xlsx", "excel", "xls"],
  xlsx: ["xlsx", "excel"],
  sheet: ["xlsx", "excel", "csv", "sheet"],
  word: ["docx", "word"],
  powerpoint: ["pptx", "powerpoint", "slides", "deck"],
  deck: ["pptx", "powerpoint", "slides", "deck"],
  presentation: ["pptx", "powerpoint", "slides"],
  docx: ["docx", "word"],
  doc: ["docx", "word", "document"],
  document: ["pdf", "docx", "document"],
  documents: ["pdf", "docx", "document"],
  ppt: ["pptx", "powerpoint", "slides"],
  pptx: ["pptx", "powerpoint", "slides"],
  slides: ["pptx", "powerpoint", "slides"],
  video: ["video", "mp4", "mov"],
  videos: ["video", "mp4"],
  movie: ["video", "mp4"],
  audio: ["audio", "mp3", "wav"],
  sound: ["audio", "mp3"],
  song: ["audio", "mp3"],
  music: ["audio", "mp3"],
  voice: ["audio", "speech", "dictation"],
  text: ["text", "txt"],
  zip: ["zip", "archive"],
  archive: ["zip", "archive"],
  smaller: ["compress"],
  reduce: ["compress"],
  shrink: ["compress"],
  combine: ["merge"],
  join: ["merge"],
  separate: ["split"],
  cut: ["trim", "split", "cut"],
  scan: ["ocr", "scanned"],
  scanned: ["ocr", "scanned"],
  readable: ["ocr", "readability"],
  money: ["currency", "amount"],
  dollars: ["currency", "usd"],
  rupees: ["currency", "inr"],
  time: ["time", "timezone", "clock"],
  pass: ["password"],
  pwd: ["password"],
  mail: ["email"],
  emails: ["email"],
  fake: ["dummy", "test data", "sample"],
  sample: ["dummy", "test data", "sample"],
  statement: ["statement", "bank"],
  statements: ["statement", "bank"],
  transactions: ["transactions", "bank"],
  black: ["redact"],
  hide: ["redact", "blur", "pixelate"],
  secret: ["password", "protect", "redact"],
  lock: ["protect", "password"],
  unlock: ["unlock", "password"],
};

const index = new Fuse(tools, {
  includeScore: true,
  threshold: 0.38,
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: "name", weight: 0.5 },
    { name: "keywords", weight: 0.3 },
    { name: "description", weight: 0.15 },
    { name: "id", weight: 0.05 },
  ],
});

export interface SearchHit {
  tool: ToolDefinition;
  score: number; // lower is better
  categoryName: string;
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? "" : m));

function tokens(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").split(/[\s/]+/).filter((w) => w && !STOP.has(w));
}

function expand(words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    out.add(stem(w));
    for (const e of EXPAND[w] ?? EXPAND[stem(w)] ?? []) out.add(e);
  }
  return [...out];
}

/** Searchable text per tool, built once. */
const corpus = new Map<string, { text: string; name: string; inputs: string[]; outputs: string[] }>();
for (const t of tools) {
  corpus.set(t.id, {
    text: [t.name, t.description, ...t.keywords, ...t.input, ...t.output, categoryById[t.category].name].join(" ").toLowerCase(),
    name: t.name.toLowerCase(),
    inputs: t.input.map((i) => i.toLowerCase()),
    outputs: t.output.map((o) => o.toLowerCase()),
  });
}

const outputMatches = (tool: ToolDefinition, want: string[]) => want.some((w) => tool.output.some((o) => o.toLowerCase() === w || (w === "image" && ["jpg", "png", "webp"].includes(o.toLowerCase())) || (w === "jpeg" && o === "jpg")));
const inputMatches = (tool: ToolDefinition, want: string[]) => want.some((w) => (w === "image" ? tool.input.some((i) => i.startsWith("image")) : accepts(tool, w)));

export function searchTools(query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scores = new Map<string, number>(); // higher is better

  // 1. Phrase synonyms
  for (const [phrase, ids] of Object.entries(synonyms)) {
    if (q.includes(phrase)) ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 10 - i));
  }

  // 2 & 3. Tokens and conversion intent
  const words = tokens(q);
  const conv = q.match(/(.+?)\s+(?:to|into|as|->|→)\s+(.+)$/);
  if (conv) {
    const from = expand(tokens(conv[1]));
    const to = expand(tokens(conv[2]));
    for (const t of tools) {
      if (t.kind !== "file") continue;
      const inOk = inputMatches(t, from);
      const outOk = outputMatches(t, to);
      if (inOk && outOk) scores.set(t.id, (scores.get(t.id) ?? 0) + 8);
      else if (outOk && /to|into/.test(q)) scores.set(t.id, (scores.get(t.id) ?? 0) + 2);
    }
  }
  const terms = expand(words);
  if (terms.length) {
    for (const t of tools) {
      const c = corpus.get(t.id)!;
      let s = 0;
      for (const term of terms) {
        if (term.length < 2) continue;
        if (c.name.includes(term)) s += 3;
        else if (t.keywords.some((k) => k.toLowerCase().includes(term))) s += 2;
        else if (c.text.includes(term)) s += 1;
      }
      if (s) scores.set(t.id, (scores.get(t.id) ?? 0) + s);
    }
  }

  // 5. Fuzzy
  for (const r of index.search(q, { limit: limit * 2 })) {
    scores.set(r.item.id, (scores.get(r.item.id) ?? 0) + Math.max(0, 4 - (r.score ?? 1) * 6));
  }

  return [...scores.entries()]
    .map(([id]) => tools.find((t) => t.id === id)!)
    .filter(Boolean)
    .map((tool) => ({ tool, score: -(scores.get(tool.id) ?? 0), categoryName: categoryById[tool.category].name }))
    .sort((a, b) => Number(a.tool.status !== "ready") - Number(b.tool.status !== "ready") || a.score - b.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit);
}
