import Fuse from "fuse.js";
import { tools } from "@/tools/registry";
import { categoryById } from "@/tools/categories";
import type { ToolDefinition } from "@/types/tool";

/** Common phrasings that should land on a specific tool. */
const synonyms: Record<string, string[]> = {
  "mp4 to mp3": ["extract-audio"],
  "extract text from a scanned document": ["ocr-pdf"],
  "scanned": ["ocr-pdf"],
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
  "redact": ["redact-pdf", "redact-pdf-text"],
  "reorder": ["organize-pdf"],
  "rearrange": ["organize-pdf"],
  "fill form": ["fill-pdf-form"],
  "password": ["protect-pdf", "unlock-pdf"],
  "signature": ["sign-pdf"],
  "miles to": ["unit-converter"],
  "to km": ["unit-converter"],
  "fiscal": ["date-math"],
  "days between": ["date-math"],
  "split statement": ["statement-splitter", "split-pdf-smart"],
  "reconcil": ["bank-reconciliation"],
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
  score: number;
  categoryName: string;
}

export function searchTools(query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const boosted = new Map<string, number>();
  for (const [phrase, ids] of Object.entries(synonyms)) {
    if (q.includes(phrase)) ids.forEach((id, i) => boosted.set(id, -1 + i * 0.01));
  }
  const results = index.search(q, { limit: limit * 2 });
  const merged = new Map<string, SearchHit>();
  for (const [id, score] of boosted) {
    const tool = tools.find((t) => t.id === id);
    if (tool) merged.set(id, { tool, score, categoryName: categoryById[tool.category].name });
  }
  for (const r of results) {
    if (!merged.has(r.item.id)) merged.set(r.item.id, { tool: r.item, score: r.score ?? 1, categoryName: categoryById[r.item.category].name });
  }
  return [...merged.values()]
    .sort((a, b) => Number(a.tool.status !== "ready") - Number(b.tool.status !== "ready") || a.score - b.score)
    .slice(0, limit);
}
