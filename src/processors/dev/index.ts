import type { CalcProcessor, TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { textOutput, jsonOutput } from "../shared/output";
import { allHashes } from "../shared/hash";
import { formatSql } from "./sql";
import { describeCron, nextCronRuns } from "./cron";
import { parseColor, colorFormats } from "./color";

const indentOf = (v: unknown) => (String(v ?? "2") === "tab" ? "\t" : " ".repeat(Number(v ?? 2)));

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    const pos = msg.match(/position (\d+)/);
    let hint: string | undefined;
    if (pos) {
      const p = Number(pos[1]);
      const line = input.slice(0, p).split("\n").length;
      const col = p - input.lastIndexOf("\n", p - 1);
      hint = `Line ${line}, column ${col}`;
    }
    throw new ProcessorError(msg, hint);
  }
}

const sortKeysDeep = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeysDeep) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])])) : v;

export const jsonFormat: TextProcessor = async (input, { options }) => {
  if (!input.trim()) throw new ProcessorError("Paste some JSON first");
  let data = parseJson(input);
  if (options.sortKeys) data = sortKeysDeep(data);
  const out = JSON.stringify(data, null, indentOf(options.indent));
  return textOutput(out, undefined, { Input: `${input.length} chars`, Output: `${out.length} chars` });
};

export const jsonValidate: TextProcessor = async (input) => {
  if (!input.trim()) throw new ProcessorError("Paste some JSON first");
  const data = parseJson(input);
  const type = Array.isArray(data) ? `array (${data.length} items)` : data === null ? "null" : typeof data === "object" ? `object (${Object.keys(data).length} keys)` : typeof data;
  return textOutput(`Valid JSON\nTop level: ${type}`, undefined, { Status: "Valid", "Top level": type });
};

export const jsonMinify: TextProcessor = async (input) => {
  if (!input.trim()) throw new ProcessorError("Paste some JSON first");
  const out = JSON.stringify(parseJson(input));
  return textOutput(out, undefined, { Original: `${input.length} chars`, Output: `${out.length} chars`, Saved: `${(((input.length - out.length) / Math.max(1, input.length)) * 100).toFixed(1)}%` });
};

export const xmlFormat: TextProcessor = async (input, { options }) => {
  const src = input.trim();
  if (!src) throw new ProcessorError("Paste some XML first");
  const ind = indentOf(options.indent);
  const tokens = src.replace(/>\s+</g, "><").split(/(?=<)|(?<=>)/).filter((t) => t.trim());
  let depth = 0;
  const lines: string[] = [];
  for (const t of tokens) {
    const tok = t.trim();
    const closing = tok.startsWith("</");
    const selfClosing = tok.endsWith("/>");
    const declaration = tok.startsWith("<?") || tok.startsWith("<!");
    if (closing) depth = Math.max(0, depth - 1);
    if (tok.startsWith("<")) lines.push(ind.repeat(depth) + tok);
    else if (lines.length) lines[lines.length - 1] += tok;
    else lines.push(tok);
    if (tok.startsWith("<") && !closing && !selfClosing && !declaration) depth++;
  }
  // Collapse leaf elements with inline text: <a>text</a>
  const out = lines.join("\n").replace(/(<([\w:.-]+)[^>]*>)([^<\n]*)\n\s*(<\/\2>)/g, "$1$3$4");
  return textOutput(out);
};

export const yamlFormat: TextProcessor = async (input, { options }) => {
  if (!input.trim()) throw new ProcessorError("Paste some YAML first");
  const YAML = await import("yaml");
  let data: unknown;
  try {
    data = YAML.parse(input);
  } catch (e) {
    throw new ProcessorError("Invalid YAML", e instanceof Error ? e.message : undefined);
  }
  const out = String(options.to ?? "yaml") === "json" ? JSON.stringify(data, null, 2) : YAML.stringify(data, { indent: 2 });
  return textOutput(out);
};

export const sqlFormat: TextProcessor = async (input, { options }) => {
  if (!input.trim()) throw new ProcessorError("Paste a SQL statement first");
  return textOutput(formatSql(input, String(options.keywordCase ?? "upper") === "lower"));
};

export const regexTest: TextProcessor = async (input, { options }) => {
  const pattern = String(options.pattern ?? "");
  if (!pattern) throw new ProcessorError("Enter a pattern");
  let re: RegExp;
  try {
    re = new RegExp(pattern, String(options.flags ?? "g"));
  } catch (e) {
    throw new ProcessorError("Invalid regular expression", e instanceof Error ? e.message : undefined);
  }
  const matches: { match: string; index: number; groups: string[]; named: Record<string, string> }[] = [];
  if (re.global) {
    for (const m of input.matchAll(re)) matches.push({ match: m[0], index: m.index ?? 0, groups: m.slice(1), named: { ...(m.groups ?? {}) } });
  } else {
    const m = re.exec(input);
    if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1), named: { ...(m.groups ?? {}) } });
  }
  const text = matches.length
    ? matches.map((m, i) => `${i + 1}. "${m.match}" at ${m.index}${m.groups.length ? `  groups: ${m.groups.map((g) => JSON.stringify(g)).join(", ")}` : ""}`).join("\n")
    : "No matches";
  return textOutput(text, matches, { Matches: String(matches.length) });
};

export const urlEncode: TextProcessor = async (input, { options }) => textOutput(options.component === false ? encodeURI(input) : encodeURIComponent(input));

export const urlDecode: TextProcessor = async (input) => {
  try {
    return textOutput(decodeURIComponent(input.replace(/\+/g, " ")));
  } catch {
    throw new ProcessorError("Input is not valid percent-encoding");
  }
};

const b64encode = (s: string, urlSafe: boolean) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const out = btoa(bin);
  return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
};
const b64decode = (s: string) => {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new ProcessorError("Input is not valid Base64");
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const base64: TextProcessor = async (input, { options }) =>
  textOutput(String(options.mode ?? "encode") === "decode" ? b64decode(input) : b64encode(input, Boolean(options.urlSafe)));

export const hash: TextProcessor = async (input) => {
  const h = await allHashes(new TextEncoder().encode(input));
  return textOutput(`MD5:     ${h.md5}\nSHA-1:   ${h.sha1}\nSHA-256: ${h.sha256}\nSHA-512: ${h.sha512}`, h);
};

export const jwtDecode: TextProcessor = async (input) => {
  const parts = input.trim().split(".");
  if (parts.length < 2) throw new ProcessorError("Not a JWT", "Expected header.payload.signature");
  const dec = (p: string) => JSON.parse(b64decode(p));
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = dec(parts[0]);
    payload = dec(parts[1]);
  } catch {
    throw new ProcessorError("Could not decode token segments");
  }
  const stats: Record<string, string> = { Algorithm: String(header.alg ?? "?") };
  const t = (k: string) => (typeof payload[k] === "number" ? new Date((payload[k] as number) * 1000).toISOString() : undefined);
  if (t("exp")) stats.Expires = `${t("exp")} (${(payload.exp as number) * 1000 < Date.now() ? "expired" : "valid"})`;
  if (t("iat")) stats.Issued = t("iat")!;
  const out = { header, payload, signature: parts[2] ?? "", note: "Signature not verified." };
  return jsonOutput(out, stats);
};

export const uuid: CalcProcessor = async ({ options }) => {
  const count = Math.min(1000, Math.max(1, Number(options.count ?? 5)));
  const ids = Array.from({ length: count }, () => crypto.randomUUID()).map((u) => (options.upper ? u.toUpperCase() : u));
  return textOutput(ids.join("\n"), ids, { Generated: String(count) });
};

export const timestamp: TextProcessor = async (input) => {
  const s = input.trim();
  let date: Date;
  if (!s) date = new Date();
  else if (/^\d{10}$/.test(s)) date = new Date(Number(s) * 1000);
  else if (/^\d{13}$/.test(s)) date = new Date(Number(s));
  else {
    date = new Date(s);
    if (isNaN(date.getTime())) throw new ProcessorError("Could not parse that timestamp or date");
  }
  const unix = Math.floor(date.getTime() / 1000);
  const out = {
    unixSeconds: unix,
    unixMilliseconds: date.getTime(),
    iso: date.toISOString(),
    utc: date.toUTCString(),
    local: date.toString(),
    relative: relativeTime(date),
  };
  return jsonOutput(out, { Unix: String(unix), ISO: out.iso });
};

function relativeTime(d: Date): string {
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  for (const [sec, name] of units) {
    if (abs >= sec) {
      const v = Math.round(abs / sec);
      return `${v} ${name}${v === 1 ? "" : "s"} ${diff < 0 ? "ago" : "from now"}`;
    }
  }
  return "now";
}

export const cron: TextProcessor = async (input, { options }) => {
  const expr = input.trim();
  if (!expr) throw new ProcessorError("Enter a cron expression", "Example: 0 9 * * 1-5");
  const description = describeCron(expr);
  const runs = nextCronRuns(expr, Math.min(20, Math.max(1, Number(options.count ?? 5))));
  const text = `${description}\n\nNext runs (local time):\n${runs.map((d) => d.toLocaleString()).join("\n")}`;
  return textOutput(text, { description, runs: runs.map((d) => d.toISOString()) }, { Schedule: description });
};

export const htmlFormat: TextProcessor = async (input, { options }) => {
  const ind = indentOf(options.indent);
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  const tokens = input.replace(/>\s+</g, "><").split(/(?=<)|(?<=>)/).map((t) => t.trim()).filter(Boolean);
  let depth = 0;
  const out: string[] = [];
  for (const t of tokens) {
    const closing = /^<\//.test(t);
    const tag = t.match(/^<\/?([a-zA-Z0-9-]+)/)?.[1]?.toLowerCase();
    if (closing) depth = Math.max(0, depth - 1);
    out.push(ind.repeat(depth) + t);
    if (t.startsWith("<") && !closing && !t.startsWith("<!") && !t.endsWith("/>") && tag && !voids.has(tag)) depth++;
  }
  return textOutput(out.join("\n"));
};

export const markdown: TextProcessor = async (input) => {
  const { marked } = await import("marked");
  const html = await marked.parse(input, { gfm: true, breaks: false });
  return { files: [], text: html, data: { html } };
};

export const cssFormat: TextProcessor = async (input, { options }) => {
  if (String(options.mode ?? "beautify") === "minify") {
    const out = input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1").replace(/;}/g, "}").trim();
    return textOutput(out, undefined, { Original: `${input.length} chars`, Output: `${out.length} chars` });
  }
  const out = input
    .replace(/\s*\{\s*/g, " {\n  ")
    .replace(/;\s*(?!\})/g, ";\n  ")
    .replace(/;?\s*\}\s*/g, ";\n}\n\n")
    .replace(/\{\n  ;\n\}/g, "{\n}")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return textOutput(out);
};

export const color: TextProcessor = async (input) => {
  const c = parseColor(input.trim());
  if (!c) throw new ProcessorError("Could not parse that colour", "Try #4F5BD5, rgb(79, 91, 213) or hsl(235, 63%, 57%)");
  const f = colorFormats(c);
  return jsonOutput(f, { HEX: f.hex, RGB: f.rgb, HSL: f.hsl });
};

export const jsFormat: TextProcessor = async () => {
  throw new ProcessorError("JS formatter is not available yet");
};
