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
vi.mock("@/lib/server/store", () => ({ store: () => ({ recordAudit, recordUsage, snapshot: async () => ({ usage: [], audit: [], users: {} }), listAccounts: async () => [], getAccount: async () => null, saveAccount: async () => {}, deleteAccount: async () => {}, kind: "mock" }) }));

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", host: "localhost", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  recordAudit.mockClear();
  recordUsage.mockClear();
});

describe("/api/health", async () => {
  const { GET } = await import("@/app/api/health/route");
  it("reports registry stats", async () => {
    const res = GET();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.registry.ready).toBeGreaterThan(50);
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
