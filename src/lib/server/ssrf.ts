import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

/**
 * Server-side request forgery guard for the web tools.
 * Only http(s), only public addresses. The host name is resolved once, every
 * returned address is checked, and the connection is then PINNED to the
 * validated address (custom socket lookup) so a DNS record that changes
 * between check and connect (DNS rebinding) cannot reach an internal host.
 * Host header and TLS SNI still carry the original host name. Redirects are
 * followed manually and each hop goes through the same validation.
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

function expandIPv6(ip: string): string {
  // Returns lowercase; handles "::ffff:1.2.3.4" and zone ids.
  return ip.toLowerCase().replace(/%.*$/, "");
}

function isPrivateIPv6(input: string): boolean {
  const s = expandIPv6(input);
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("::ffff:")) { const v4 = s.slice(7); return isIP(v4) === 4 ? isPrivateIPv4(v4) : true; }
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) return true; // hex form of mapped v4: refuse rather than parse
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // ULA
  if (/^fe[89ab]/.test(s)) return true; // link-local
  if (s.startsWith("ff")) return true; // multicast
  if (s.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix: could map to private v4
  if (s.startsWith("2002:")) return true; // 6to4: embeds a v4 address
  if (s.startsWith("100:")) return true; // discard-only
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
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa") || h === "metadata.google.internal" || h.endsWith(".onion")) {
    throw new SsrfError("Local and internal hosts are blocked");
  }
  // Numeric forms that bypass naive checks (0x7f000001, 2130706433, 127.1) are normalised by the URL parser into dotted form already; anything left that is not a name or IP is rejected.
  if (!/^[a-z0-9.\-[\]:]+$/i.test(u.hostname)) throw new SsrfError("Unsupported host name");
  const literal = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isPrivateAddress(literal)) throw new SsrfError("Private network addresses are blocked");
  return u;
}

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = async (hostname) => {
  const r = await dnsLookup(hostname, { all: true, verbatim: true });
  return r.map((a) => ({ address: a.address, family: a.family }));
};

/**
 * Resolve a host name and return ONE validated public address to connect to.
 * Every address the resolver returns must be public; a mixed answer is
 * refused because an attacker controls which one a naive client would use.
 */
export async function resolvePublicAddress(hostname: string, lookup: LookupFn = defaultLookup): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError("Private network addresses are blocked");
    return { address: host, family: isIP(host) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new SsrfError(`Could not resolve ${host}`);
  }
  if (!addrs.length) throw new SsrfError(`Could not resolve ${host}`);
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new SsrfError("Host resolves to a private network address", "Internal services cannot be fetched through this tool.");
  return addrs[0];
}

/** Backwards-compatible helper: validate and return the pinned address as a string. */
export async function assertPublicHost(hostname: string, lookup?: LookupFn): Promise<string> {
  return (await resolvePublicAddress(hostname, lookup)).address;
}

/** An undici Agent whose sockets always connect to one pre-validated address, keeping SNI/Host as the original name. */
export class PinnedAgent extends Agent {
  readonly pinnedAddress: string;
  constructor(address: string, family: number) {
    super({
      connect: {
        // undici passes this to net/tls.connect; returning the pinned address defeats re-resolution.
        lookup: ((_hostname: string, options: { all?: boolean }, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
          if (options?.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        }) as unknown as import("node:net").LookupFunction,
        timeout: 10_000,
      },
      connections: 4,
    });
    this.pinnedAddress = address;
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
}

export interface SafeFetchDeps {
  lookup?: LookupFn;
  fetch?: (url: URL, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
}

const BLOCKED_HEADERS = new Set(["host", "cookie", "authorization", "proxy-authorization", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer"]);

/** fetch() with SSRF validation + IP pinning on every hop and a hard byte cap on the body. */
export async function safeFetch(input: string, opts: SafeFetchOptions, deps: SafeFetchDeps = {}): Promise<{ response: Response; body: string; truncated: boolean; finalUrl: string; timeMs: number }> {
  let url = parseTarget(input);
  const started = Date.now();
  const headers: Record<string, string> = { "user-agent": "Omnifi-SuperTools/1.0 (+internal)", accept: "*/*" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (!BLOCKED_HEADERS.has(k.toLowerCase()) && /^[a-z0-9-]+$/i.test(k)) headers[k] = v.replace(/[\r\n]/g, "");
  }
  const doFetch = deps.fetch ?? ((u, init) => fetch(u, init as RequestInit));
  const maxRedirects = opts.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const pinned = await resolvePublicAddress(url.hostname, deps.lookup);
    const agent = new PinnedAgent(pinned.address, pinned.family);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { method: opts.method ?? "GET", headers, body: opts.body, redirect: "manual", signal: controller.signal, dispatcher: agent });
    } catch (e) {
      clearTimeout(timer);
      void agent.close();
      if (controller.signal.aborted) throw new SsrfError("The site took too long to respond");
      throw new SsrfError("Could not connect", e instanceof Error ? e.message.slice(0, 200) : undefined);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      void agent.close();
      let next: URL;
      try { next = new URL(res.headers.get("location")!, url); } catch { throw new SsrfError("Redirected to an invalid URL"); }
      url = parseTarget(next.href); // re-validates scheme, credentials and blocked names
      continue;
    }
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
    void agent.close();
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
