import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Route handler tests: exercise validation, same-origin checks and rate
 * limiting without a running server. next/headers is mocked since there is
 * no request context outside Next.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const recordAudit = vi.fn();
const recordUsage = vi.fn();
const recordFeedback = vi.fn();
const counters = new Map<string, { start: number; count: number }>();
const cache = new Map<string, string>();
vi.mock("@/lib/server/store", () => ({ store: () => ({
  recordAudit, recordUsage, recordFeedback,
  listFeedback: async () => [],
  snapshot: async () => ({ usage: [], audit: [], users: {} }),
  listAccounts: async () => [], getAccount: async () => null, saveAccount: async () => {}, deleteAccount: async () => {},
  getPrefs: async () => null, savePrefs: async () => {},
  rateHit: async (key: string, start: number) => { const c = counters.get(key); const n = c && c.start === start ? c.count + 1 : 1; counters.set(key, { start, count: n }); return n; },
  cacheGet: async (key: string) => cache.get(key) ?? null, cacheSet: async (key: string, value: string) => { cache.set(key, value); },
  purge: async () => ({}),
  kind: "mock",
}) }));

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", host: "localhost", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  recordAudit.mockClear();
  recordUsage.mockClear();
});

describe("/api/health", async () => {
  const { GET } = await import("@/app/api/health/route");
  it("is minimal: liveness only, no implementation details", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Object.keys(data).sort()).toEqual(["ok", "time"]);
  });
});

describe("/api/telemetry", async () => {
  const { POST } = await import("@/app/api/telemetry/route");
  it("accepts a valid event and stores nothing but the schema fields", async () => {
    const res = await POST(json("/api/telemetry", { tool: "merge-pdf", ok: true, ms: 120, files: 2, cancelled: false, fileName: "secret.pdf" }));
    expect(res.status).toBe(200);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).not.toHaveProperty("fileName");
  });
  it("rejects unknown tools and bad shapes", async () => {
    expect((await POST(json("/api/telemetry", { tool: "nope", ok: true, ms: 1, files: 0 }))).status).toBe(400);
    expect((await POST(json("/api/telemetry", { tool: "merge-pdf", ok: "yes" }))).status).toBe(400);
  });
});

describe("/api/web", async () => {
  const { POST } = await import("@/app/api/web/route");
  it("blocks cross-origin callers", async () => {
    const res = await POST(json("/api/web", { action: "headers", target: "https://example.com" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
  it("rejects unknown actions and private targets without fetching", async () => {
    expect((await POST(json("/api/web", { action: "shell", target: "x" }))).status).toBe(400);
    const res = await POST(json("/api/web", { action: "headers", target: "http://127.0.0.1:8080/admin" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/blocked|Private/);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("/api/ai/run", async () => {
  const { POST } = await import("@/app/api/ai/run/route");
  it("returns 503 with a hint when no provider is configured", async () => {
    const res = await POST(json("/api/ai/run", { task: "summarize", input: "hello", options: {} }));
    expect(res.status).toBe(503);
    expect((await res.json()).hint).toMatch(/AI_PROVIDER/);
  });
  it("rejects unknown tasks", async () => {
    expect((await POST(json("/api/ai/run", { task: "rm -rf", input: "x" }))).status).toBe(400);
  });
});

describe("/api/auth/login", async () => {
  const { POST } = await import("@/app/api/auth/login/route");
  it("explains when no accounts exist", async () => {
    const res = await POST(json("/api/auth/login", { username: "admin", password: "x" }));
    expect(res.status).toBe(503);
  });
});

describe("Gemini provider", () => {
  it("builds a generateContent request and reads the candidate text", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-real";
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] }, finishReason: "STOP" }], modelVersion: "gemini-3.8-flash", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } }), { status: 200 });
    }) as typeof fetch;
    try {
      const { complete, aiStatus } = await import("@/lib/server/ai");
      expect(aiStatus()).toMatchObject({ configured: true, provider: "gemini", model: "gemini-3.8-flash" });
      const r = await complete("You are terse.", "Say hi", { maxTokens: 50 });
      expect(r.text).toBe("Hello from Gemini");
      expect(r.usage).toEqual({ input: 5, output: 3 });
      expect(calls[0].url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-key-not-real");
      expect(calls[0].url).not.toContain("test-key-not-real"); // key travels in a header, never the URL
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.systemInstruction.parts[0].text).toBe("You are terse.");
      expect(body.contents[0].parts[0].text).toBe("Say hi");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.AI_PROVIDER; delete process.env.GEMINI_API_KEY;
    }
  });
});

describe("AI run: free-tier controls", () => {
  it("answers identical requests from cache (one provider call), routes lite tasks to the lite model, and paces globally", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-real";
    process.env.AI_GLOBAL_PER_MIN = "2";
    process.env.AI_CACHE_DAYS = "7";
    let providerCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      providerCalls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `reply for ${String(url).includes("flash-lite") ? "lite" : "standard"}` }] }, finishReason: "STOP" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/run/route");
      const call = (task: string, input: string) => POST(json("/api/ai/run", { task, input, options: {} }));
      const a = await (await call("subjectLines", "Please send the Q3 statements")).json();
      expect(a.text).toBe("reply for lite"); // lite-tier task used the lite model
      expect(a.cached).toBe(false);
      const b = await (await call("subjectLines", "Please send the Q3 statements")).json();
      expect(b.cached).toBe(true); // second identical request: no provider call
      expect(providerCalls).toBe(1);
      await call("summarize", "something new 1");
      const third = await call("summarize", "something new 2"); // 3rd uncached call in the minute exceeds AI_GLOBAL_PER_MIN=2
      expect(third.status).toBe(429);
      expect((await third.json()).hint).toMatch(/per minute/);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ["AI_PROVIDER", "GEMINI_API_KEY", "AI_GLOBAL_PER_MIN", "AI_CACHE_DAYS"]) delete process.env[k];
    }
  });
});
