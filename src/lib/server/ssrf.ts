import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side request forgery guard for the web tools.
 * Only http(s), only public addresses, DNS resolved and checked before
 * every hop, redirects followed manually so each target is re-validated.
 */
export class SsrfError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) return true;
  if (s.startsWith("::ffff:")) return isPrivateIPv4(s.slice(7));
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

export function parseTarget(input: string): URL {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new SsrfError("Not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SsrfError("Only http and https are allowed");
  if (u.username || u.password) throw new SsrfError("Credentials in URLs are not allowed");
  if (!u.hostname || u.hostname === "localhost" || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) {
    throw new SsrfError("Local and internal hosts are blocked");
  }
  return u;
}

export async function assertPublicHost(hostname: string): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError("Private network addresses are blocked");
    return host;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfError(`Could not resolve ${host}`);
  }
  if (!addrs.length) throw new SsrfError(`Could not resolve ${host}`);
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new SsrfError("Host resolves to a private network address", "Internal services cannot be fetched through this tool.");
  return addrs[0].address;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
}

const BLOCKED_HEADERS = new Set(["host", "cookie", "authorization", "proxy-authorization", "x-forwarded-for", "x-forwarded-host", "content-length", "transfer-encoding", "connection"]);

/** fetch() with SSRF validation on every hop and a hard byte cap on the body. */
export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<{ response: Response; body: string; truncated: boolean; finalUrl: string; timeMs: number }> {
  let url = parseTarget(input);
  const started = Date.now();
  const headers: Record<string, string> = { "user-agent": "OmniFi-SuperTools/1.0 (+internal)", accept: "*/*" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (!BLOCKED_HEADERS.has(k.toLowerCase()) && /^[a-z0-9-]+$/i.test(k)) headers[k] = v.replace(/[\r\n]/g, "");
  }
  const maxRedirects = opts.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method ?? "GET", headers, body: opts.body, redirect: "manual", signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new SsrfError("The site took too long to respond");
      throw new SsrfError("Could not connect", e instanceof Error ? e.message : undefined);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      url = new URL(res.headers.get("location")!, url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("Redirected to a non-http URL");
      continue;
    }
    // Read body with a cap.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > opts.maxBytes) {
          truncated = true;
          chunks.push(value.subarray(0, value.length - (received - opts.maxBytes)));
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    clearTimeout(timer);
    const body = new TextDecoder().decode(concat(chunks));
    return { response: res, body, truncated, finalUrl: url.href, timeMs: Date.now() - started };
  }
  throw new SsrfError("Too many redirects");
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
