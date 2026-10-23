import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { sanitizeHtml, previewDocument } from "../src/lib/sanitize";

/**
 * Security regression tests: fail-closed auth, forged SSO headers, XSS
 * sanitisation, SSRF DNS pinning, durable rate limits, data retention.
 * Modules are imported lazily after the environment is arranged, because
 * env.ts snapshots process.env at import time.
 */

const SECRET = "p".repeat(40);
const saved = { ...process.env };
function resetEnv(extra: Record<string, string | undefined> = {}) {
  for (const k of ["NODE_ENV", "ADMIN_PASSWORD", "USERS_JSON", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AUTH_MODE", "AUTH_PROXY_SECRET", "SESSION_SECRET", "DATA_DIR", "TRUST_PROXY_HEADERS", "DATABASE_URL"]) delete process.env[k];
  Object.assign(process.env, extra);
  vi.resetModules();
}
afterEach(() => { process.env = { ...saved }; vi.resetModules(); });

/* ---------- Edge proxy: fail closed + forged identity headers ---------- */

describe("edge proxy gate", () => {
  async function run(pathname: string, headers: Record<string, string> = {}, cookie?: string) {
    const { proxy } = await import("../src/proxy");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(`https://supertools.test${pathname}`, { headers: { host: "supertools.test", ...headers, ...(cookie ? { cookie } : {}) } });
    return proxy(req);
  }
  it("production without any sign-in method fails closed with 503 (except the health check)", async () => {
    resetEnv({ NODE_ENV: "production" });
    expect((await run("/")).status).toBe(503);
    expect((await run("/api/web")).status).toBe(503);
    expect((await run("/login")).status).toBe(503);
    const h = await run("/api/health");
    expect(h.status).not.toBe(503);
  });
  it("production with a password configured requires a session for everything but public paths", async () => {
    resetEnv({ NODE_ENV: "production", ADMIN_PASSWORD: "x", SESSION_SECRET: "s".repeat(40) });
    expect((await run("/api/ai/run")).status).toBe(401);
    expect((await run("/tool/merge-pdf")).status).toBe(307);
    expect((await run("/login")).status).toBe(200);
    expect((await run("/api/health")).status).toBe(200);
  });
  it("header SSO without the proxy secret configured fails closed", async () => {
    resetEnv({ NODE_ENV: "production", AUTH_MODE: "header" });
    expect((await run("/", { "x-forwarded-email": "a@myomnifi.com" })).status).toBe(503);
  });
  it("forged x-forwarded-email / x-forwarded-user headers never authenticate", async () => {
    resetEnv({ NODE_ENV: "production", AUTH_MODE: "header", AUTH_PROXY_SECRET: SECRET });
    expect((await run("/api/web", { "x-forwarded-email": "ceo@myomnifi.com", "x-forwarded-user": "CEO" })).status).toBe(401);
    expect((await run("/api/web", { "x-forwarded-email": "ceo@myomnifi.com", "x-omnifi-proxy-secret": "wrong" })).status).toBe(401);
    expect((await run("/api/web", { "x-forwarded-email": "ceo@myomnifi.com", "x-omnifi-proxy-secret": SECRET })).status).not.toBe(401);
  });
  it("a session cookie signed with a different secret is rejected and no dev fallback secret exists in production", async () => {
    resetEnv({ NODE_ENV: "production", ADMIN_PASSWORD: "x" }); // no SESSION_SECRET
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ user: { id: "x", email: "x@y", role: "admin" } }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode("dev-only-secret-change-me-dev-only-secret-change-me"));
    expect((await run("/api/web", {}, `omnifi_st_session=${forged}`)).status).toBe(401);
  });
  it("sets the hardened headers and a CSP without unsafe-eval", async () => {
    resetEnv({ ADMIN_PASSWORD: "x" });
    const res = await run("/login");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("wasm-unsafe-eval");
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

/* ---------- Server-side auth helpers ---------- */

describe("server auth helpers", () => {
  it("userFromProxyHeaders ignores identity headers unless the proxy secret matches", async () => {
    resetEnv({ AUTH_MODE: "header", AUTH_PROXY_SECRET: SECRET });
    const { userFromProxyHeaders, headerAuthConfigured } = await import("../src/lib/server/auth");
    expect(headerAuthConfigured()).toBe(true);
    expect(userFromProxyHeaders(new Headers({ "x-forwarded-email": "a@myomnifi.com" }))).toBeNull();
    expect(userFromProxyHeaders(new Headers({ "x-forwarded-email": "a@myomnifi.com", "x-omnifi-proxy-secret": "nope" }))).toBeNull();
    expect(userFromProxyHeaders(new Headers({ "x-forwarded-email": "A@myomnifi.com", "x-forwarded-user": "Ann", "x-omnifi-proxy-secret": SECRET }))?.email).toBe("a@myomnifi.com");
  });
  it("header mode with a short or missing secret is misconfigured, and production without any method is misconfigured", async () => {
    resetEnv({ AUTH_MODE: "header", AUTH_PROXY_SECRET: "short" });
    let a = await import("../src/lib/server/auth");
    expect(a.headerAuthConfigured()).toBe(false);
    expect(a.authMisconfigured()).toBe(true);
    resetEnv({ NODE_ENV: "production" });
    a = await import("../src/lib/server/auth");
    expect(a.authRequired()).toBe(true);
    expect(a.authMisconfigured()).toBe(true);
    await expect(a.requireUser()).rejects.toMatchObject({ status: 503 });
  });
});

/* ---------- Protected routes refuse anonymous callers ---------- */

describe("protected API routes", () => {
  beforeEach(() => {
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
    vi.doMock("@/lib/server/store", () => ({ store: () => ({ recordAudit: vi.fn(), recordUsage: vi.fn(), recordFeedback: vi.fn(), listFeedback: async () => [], rateHit: async () => 1, cacheGet: async () => null, cacheSet: async () => {}, purge: async () => ({}), listAccounts: async () => [], getAccount: async () => null, kind: "mock" }) }));
  });
  afterEach(() => { vi.doUnmock("next/headers"); vi.doUnmock("@/lib/server/store"); });
  const json = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify(body) });
  it("/api/ai/run and /api/web return 401 without a session once sign-in is configured", async () => {
    resetEnv({ ADMIN_PASSWORD: "x" });
    const ai = await import("../src/app/api/ai/run/route");
    const web = await import("../src/app/api/web/route");
    expect((await ai.POST(json("/api/ai/run", { task: "summarize", input: "hello" }))).status).toBe(401);
    expect((await web.POST(json("/api/web", { action: "headers", target: "https://example.com" }))).status).toBe(401);
  });
});

/* ---------- XSS: allowlist sanitiser + sandboxed preview ---------- */

describe("HTML preview sanitiser", () => {
  const purifier = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
  const clean = (h: string) => sanitizeHtml(h, purifier);
  it("keeps ordinary Markdown-derived HTML", () => {
    const out = clean('<h1>Title</h1><p>Some <strong>bold</strong> and <a href="https://example.com">a link</a></p><table><tr><th>A</th><td>1</td></tr></table><img src="https://example.com/x.png" alt="x"><pre><code>x = 1</code></pre>');
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com"[^>]*rel="noopener noreferrer nofollow"/);
    expect(out).toContain("<th>A</th>");
    expect(out).toContain('src="https://example.com/x.png"');
  });
  it("removes scripts, handlers, dangerous URLs, SVG/MathML vectors, forms and CSS", () => {
    const vectors = [
      "<script>alert(1)</script>",
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
      '<svg><script>alert(1)</script></svg>',
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      "<math><mi href=\"javascript:alert(1)\">x</mi></math>",
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object><embed src="x">',
      '<form action="https://evil.example"><input name="pw"><button>go</button></form>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      "<style>body{background:url(javascript:alert(1))}</style>",
      '<p onmouseover="alert(1)">hover</p>',
      "<img src=\"x\" onerror=alert(1)//>",
      "<<script>script>alert(1)<</script>/script>",
      '<a href="vbscript:msgbox(1)">x</a>',
      '<base href="https://evil.example/">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<img srcset="x onerror=alert(1)">',
      '<details open ontoggle="alert(1)">x</details>',
      '<video><source onerror="alert(1)"></video>',
      '<a href="https://ok.example" target="_top" ping="https://evil.example">x</a>',
    ];
    for (const v of vectors) {
      const out = clean(v).toLowerCase();
      expect(out, v).not.toMatch(/<script|onerror|onmouseover|ontoggle|javascript:|vbscript:|data:text|<iframe|<object|<embed|<form|<input|<svg|<math|<style|<base|<meta|<link|srcset|<video|ping=|target="_top"|background:/);
    }
  });
  it("wraps the sanitised body in a document whose CSP forbids scripts and network access", () => {
    const doc = previewDocument("<p>hi</p>");
    expect(doc).toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(doc).toContain("<p>hi</p>");
  });
});

/* ---------- SSRF: DNS pinning ---------- */

describe("SSRF guard", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast, mapped-IPv6 and metadata addresses", async () => {
    const { isPrivateAddress, parseTarget } = await import("../src/lib/server/ssrf");
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "fe80::1", "fd00::1", "ff02::1", "64:ff9b::7f00:1", "2002:7f00:1::"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(() => parseTarget("http://metadata.google.internal/computeMetadata")).toThrow(/blocked/);
    expect(() => parseTarget("http://user:pw@example.com")).toThrow(/Credentials/);
    expect(() => parseTarget("http://0x7f000001/")).toThrow(); // numeric forms normalise to 127.0.0.1 and are refused later
  });
  it("refuses a name that resolves to any private address, including mixed answers (rebinding bait)", async () => {
    const { resolvePublicAddress } = await import("../src/lib/server/ssrf");
    await expect(resolvePublicAddress("evil.example", async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])).rejects.toThrow(/private/i);
    await expect(resolvePublicAddress("evil.example", async () => [{ address: "127.0.0.1", family: 4 }])).rejects.toThrow(/private/i);
    const ok = await resolvePublicAddress("good.example", async () => [{ address: "93.184.216.34", family: 4 }]);
    expect(ok.address).toBe("93.184.216.34");
  });
  it("pins the connection to the validated address so a later DNS change cannot redirect it", async () => {
    const { safeFetch } = await import("../src/lib/server/ssrf");
    let calls = 0;
    const lookup = async () => (calls++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]); // rebinding after the first answer
    const seen: { url: string; pinned: string; host: string }[] = [];
    const fetchStub = async (url: URL, init: RequestInit & { dispatcher?: unknown }) => {
      const agent = init.dispatcher as { pinnedAddress: string };
      seen.push({ url: url.href, pinned: agent.pinnedAddress, host: url.hostname });
      return new Response("ok", { status: 200 });
    };
    const r = await safeFetch("https://good.example/page", { timeoutMs: 1000, maxBytes: 1000 }, { lookup, fetch: fetchStub });
    expect(r.body).toBe("ok");
    expect(seen[0].pinned).toBe("93.184.216.34");
    expect(seen[0].host).toBe("good.example"); // Host / SNI unchanged
    // A redirect hop re-resolves; the second answer is private and must be refused.
    const fetchRedirect = async () => new Response(null, { status: 302, headers: { location: "https://good.example/next" } });
    calls = 0;
    await expect(safeFetch("https://good.example/", { timeoutMs: 1000, maxBytes: 100 }, { lookup, fetch: fetchRedirect })).rejects.toThrow(/private/i);
  });
  it("never forwards identity or hop-by-hop headers from the caller", async () => {
    const { safeFetch } = await import("../src/lib/server/ssrf");
    let sent: Record<string, string> = {};
    await safeFetch("https://good.example/", { timeoutMs: 1000, maxBytes: 10, headers: { Cookie: "a=b", Authorization: "Bearer x", "X-Forwarded-For": "1.1.1.1", "X-Custom": "ok\r\nInjected: y" } }, { lookup: async () => [{ address: "93.184.216.34", family: 4 }], fetch: async (_u, init) => { sent = init.headers as Record<string, string>; return new Response(""); } });
    expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(["cookie", "authorization", "x-forwarded-for"]));
    expect(sent["X-Custom"]).toBe("okInjected: y");
  });
});

/* ---------- Rate limits, quotas, client IP trust ---------- */

describe("rate limiting and quotas", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "omnifi-store-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("counts per fixed window through the store and enforces daily quotas", async () => {
    resetEnv({ DATA_DIR: dir });
    const { rateLimit, dailyQuota } = await import("../src/lib/server/ratelimit");
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3)).ok).toBe(true);
    const blocked = await rateLimit(key, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect((await dailyQuota(key, 2)).ok).toBe(true);
    expect((await dailyQuota(key, 2)).ok).toBe(true);
    expect((await dailyQuota(key, 2)).ok).toBe(false);
    expect((await dailyQuota(key, 0)).ok).toBe(true); // 0 disables
  });
  it("only believes X-Forwarded-For when TRUST_PROXY_HEADERS is on, and then takes the proxy's (rightmost) entry", async () => {
    resetEnv({ DATA_DIR: dir });
    let { clientKey } = await import("../src/lib/server/ratelimit");
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6" } }))).toBe("ip:direct");
    resetEnv({ DATA_DIR: dir, TRUST_PROXY_HEADERS: "render" });
    ({ clientKey } = await import("../src/lib/server/ratelimit"));
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } }))).toBe("ip:203.0.113.9");
    expect(clientKey(new Request("http://x"), "alice")).toBe("u:alice");
  });
});

/* ---------- Retention and data minimisation ---------- */

describe("store retention", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "omnifi-store-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("purges usage, audit, feedback and stale preferences past their retention", async () => {
    resetEnv({ DATA_DIR: dir });
    const { store } = await import("../src/lib/server/store");
    const s = store();
    const now = Date.now();
    const day = 86_400_000;
    await s.recordUsage({ at: now - 100 * day, tool: "merge-pdf", ok: true, ms: 1, files: 1, cancelled: false });
    await s.recordUsage({ at: now, tool: "merge-pdf", ok: true, ms: 1, files: 1, cancelled: false });
    await s.recordAudit({ at: now - 200 * day, actor: "old", action: "x" });
    await s.recordFeedback({ at: now - 400 * day, from: "old", kind: "idea", tool: "", message: "ancient" });
    await s.recordFeedback({ at: now, from: "new", kind: "idea", tool: "", message: "fresh" });
    await s.savePrefs("stale", { favorites: [], recent: [], updatedAt: now - 400 * day });
    await s.savePrefs("active", { favorites: ["merge-pdf"], recent: [], updatedAt: now });
    const removed = await s.purge({ usageDays: 90, auditDays: 180, feedbackDays: 365, prefsDays: 365 }, now);
    // Usage may already have been purged by the automatic hourly purge triggered by the first write.
    expect(removed).toMatchObject({ audit: 1, feedback: 1, prefs: 1 });
    const snap = await s.snapshot();
    expect(snap.usage).toHaveLength(1);
    expect((await s.listFeedback()).map((f) => f.message)).toEqual(["fresh"]);
    expect(await s.getPrefs("stale")).toBeNull();
    expect((await s.getPrefs("active"))?.favorites).toEqual(["merge-pdf"]);
    expect(snap.audit.some((a) => a.detail?.includes("ancient") || a.detail?.includes("fresh"))).toBe(false);
  });
});
