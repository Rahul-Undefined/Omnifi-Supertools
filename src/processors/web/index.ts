import type { TextProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { jsonOutput, textOutput, fileFromText } from "../shared/output";

/** Browser-side URL parser. */
export const parseUrl: TextProcessor = async (input) => {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new ProcessorError("Not a valid absolute URL", "Include the scheme, e.g. https://");
  }
  const params: Record<string, string | string[]> = {};
  for (const [k, v] of u.searchParams) params[k] = k in params ? [...([] as string[]).concat(params[k]), v] : v;
  return jsonOutput({ href: u.href, protocol: u.protocol, username: u.username, password: u.password ? "(set)" : "", host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, pathSegments: u.pathname.split("/").filter(Boolean), search: u.search, params, hash: u.hash, origin: u.origin }, { Host: u.hostname, Params: String(u.searchParams.size) });
};

/** Everything else goes through the server, which enforces SSRF rules. */
async function callServer(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProcessorError(data.error ?? `Request failed (${res.status})`, data.hint);
  return data;
}

const mk = (action: string): TextProcessor => async (input, { options }) => {
  const target = input.trim() || String(options.url ?? "");
  if (!target) throw new ProcessorError("Enter a URL or host name");
  const data = await callServer(action, { target, options });
  if (typeof data.text === "string") {
    const ext = action === "toMarkdown" ? "md" : "txt";
    return { ...textOutput(data.text, data.data, data.stats), files: [fileFromText(`${safeName(target)}.${ext}`, data.text, ext === "md" ? "text/markdown" : "text/plain")] };
  }
  return jsonOutput(data.data, data.stats);
};

const safeName = (s: string) => s.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60) || "page";

export const headers = mk("headers");
export const dns = mk("dns");
export const ssl = mk("ssl");
export const robots = mk("robots");
export const sitemap = mk("sitemap");
export const og = mk("og");
export const meta = mk("meta");
export const favicon = mk("favicon");
export const toText = mk("toText");
export const toMarkdown = mk("toMarkdown");

export const request: TextProcessor = async (input, { options }) => {
  const url = String(options.url ?? "").trim();
  if (!url) throw new ProcessorError("Enter a URL");
  const headersObj: Record<string, string> = {};
  for (const line of String(options.headers ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headersObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const data = await callServer("request", { target: url, options: { method: String(options.method ?? "GET"), headers: headersObj, body: input } });
  const d = data.data as { status: number; statusText: string; headers: Record<string, string>; body: string; timeMs: number };
  const text = `${d.status} ${d.statusText}  (${d.timeMs} ms)\n\n${Object.entries(d.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${d.body}`;
  return { files: [], text, data: d, stats: { Status: String(d.status), Time: `${d.timeMs} ms`, Size: `${d.body.length.toLocaleString()} chars` } };
};
