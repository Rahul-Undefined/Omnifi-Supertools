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
  ratePeek: async (key: string, start: number) => { const c = counters.get(key); return c && c.start === start ? c.count : 0; },
  rateRefund: async (key: string, start: number) => { const c = counters.get(key); if (c && c.start === start && c.count > 0) c.count--; },
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

describe("Grok provider", () => {
  it("calls the xAI OpenAI-compatible endpoint with a bearer key and reads the choice text", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "grok";
    process.env.XAI_API_KEY = "test-key-not-real";
    process.env.AI_MODEL = "gemini-3.8-flash"; // stale value from another provider must be ignored
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello from Grok" } }], model: "grok-4.3", usage: { prompt_tokens: 7, completion_tokens: 2 } }), { status: 200 });
    }) as typeof fetch;
    try {
      const { complete, aiStatus, liteModel } = await import("@/lib/server/ai");
      expect(aiStatus()).toMatchObject({ configured: true, provider: "grok", model: "grok-4.3" });
      expect(liteModel()).toBe("grok-4.3");
      const r = await complete("You are terse.", "Say hi", { maxTokens: 50, json: true });
      expect(r.text).toBe("Hello from Grok");
      expect(r.usage).toEqual({ input: 7, output: 2 });
      expect(calls[0].url).toBe("https://api.x.ai/v1/chat/completions");
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-key-not-real");
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.model).toBe("grok-4.3");
      expect(body.messages[0]).toEqual({ role: "system", content: "You are terse." });
      expect(body.response_format).toEqual({ type: "json_object" });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.AI_PROVIDER; delete process.env.XAI_API_KEY; delete process.env.AI_MODEL;
    }
  });

  it("reports a missing key and surfaces xAI error strings", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "grok";
    delete process.env.XAI_API_KEY;
    try {
      const { aiStatus } = await import("@/lib/server/ai");
      expect(aiStatus()).toMatchObject({ configured: false, provider: "grok", hint: "XAI_API_KEY is missing (keys from console.x.ai start with xai-)." });
    } finally { delete process.env.AI_PROVIDER; }
    vi.resetModules();
    process.env.AI_PROVIDER = "grok"; process.env.XAI_API_KEY = "test-key-not-real";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: "400", error: "Bad data: Messages cannot be empty" }), { status: 400 })) as typeof fetch;
    try {
      const { complete } = await import("@/lib/server/ai");
      await expect(complete("s", "u")).rejects.toMatchObject({ message: "xAI API error (400)", hint: "Bad data: Messages cannot be empty" });
    } finally { globalThis.fetch = realFetch; delete process.env.AI_PROVIDER; delete process.env.XAI_API_KEY; }
  });
});

describe("Groq provider", () => {
  it("calls api.groq.com with the gsk_ key, gpt-oss defaults and the vision model for images", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_not_real";
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello from Groq" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
    }) as typeof fetch;
    try {
      const { complete, completeWithImages, aiStatus, liteModel } = await import("@/lib/server/ai");
      expect(aiStatus()).toMatchObject({ configured: true, provider: "groq", model: "openai/gpt-oss-120b" });
      expect(liteModel()).toBe("openai/gpt-oss-20b");
      const r = await complete("s", "u", { tier: "lite" });
      expect(r.text).toBe("Hello from Groq");
      expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer gsk_test_not_real");
      expect(JSON.parse(String(calls[0].init.body)).model).toBe("openai/gpt-oss-20b");
      await completeWithImages("s", "u", [{ label: "Step 1", mimeType: "image/png", base64: "AAAA" }]);
      const body = JSON.parse(String(calls[1].init.body));
      expect(body.model).toBe("qwen/qwen3.8-27b");
      expect(body.messages[1].content[2].image_url.url).toBe("data:image/png;base64,AAAA");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.AI_PROVIDER; delete process.env.GROQ_API_KEY;
    }
  });

  it("routes a Groq key pasted under the xAI setting to Groq", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "grok";
    process.env.XAI_API_KEY = "gsk_pasted_in_wrong_slot";
    process.env.AI_MODEL = "grok-4.3";
    try {
      const { aiStatus, provider } = await import("@/lib/server/ai");
      expect(provider()).toBe("groq");
      expect(aiStatus()).toMatchObject({ configured: true, provider: "groq", model: "openai/gpt-oss-120b" });
    } finally { delete process.env.AI_PROVIDER; delete process.env.XAI_API_KEY; delete process.env.AI_MODEL; }
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

describe("AI run: personal allowance and admin-only model info", () => {
  it("counts 15 per window per person, hides the model from non-admins, and cache hits are free", async () => {
    vi.resetModules();
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-real";
    process.env.AI_USER_QUOTA = "2";
    process.env.AI_USER_WINDOW_HOURS = "3";
    process.env.AI_GLOBAL_PER_MIN = "0";
    process.env.ADMIN_PASSWORD = "x"; // sign-in required -> currentUser must be mocked
    vi.doMock("@/lib/server/auth", async () => { const real = await vi.importActual<typeof import("@/lib/server/auth")>("@/lib/server/auth"); return { ...real, currentUser: async () => ({ id: "priya@myomnifi.com", name: "Priya", email: "priya@myomnifi.com", role: "user" as const }), requireUser: async () => ({ id: "priya@myomnifi.com", name: "Priya", email: "priya@myomnifi.com", role: "user" as const }) }; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], modelVersion: "gemini-x" }), { status: 200 })) as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/run/route");
      const call = (input: string) => POST(json("/api/ai/run", { task: "subjectLines", input, options: {} }));
      const a = await (await call("one")).json();
      expect(a.model).toBeUndefined(); // non-admin never sees the model
      expect(a.allowance).toMatchObject({ limit: 2, used: 1, remaining: 1 });
      const again = await (await call("one")).json();
      expect(again.cached).toBe(true);
      expect(again.allowance.used).toBe(1); // cache hit did not consume
      await call("two");
      const third = await call("three");
      expect(third.status).toBe(429);
      const body = await third.json();
      expect(body.hint).toMatch(/per 3 hours/);
      expect(body.allowance.remaining).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      vi.doUnmock("@/lib/server/auth");
      for (const k of ["AI_PROVIDER", "GEMINI_API_KEY", "AI_USER_QUOTA", "AI_USER_WINDOW_HOURS", "AI_GLOBAL_PER_MIN", "ADMIN_PASSWORD"]) delete process.env[k];
    }
  });
});
