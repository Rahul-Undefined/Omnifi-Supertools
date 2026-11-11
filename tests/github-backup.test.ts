import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Fake GitHub contents API: an in-memory map of path -> { sha, base64 }. */
function fakeGithub() {
  const files = new Map<string, { sha: string; content: string }>();
  const calls: { method: string; path: string }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/);
    if (!m) return new Response("not found", { status: 404 });
    const p = decodeURIComponent(m[2]);
    const method = init?.method ?? "GET";
    calls.push({ method, path: p });
    const auth = (init?.headers as Record<string, string>)?.authorization;
    if (auth !== "Bearer ghp_test_not_real") return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    if (method === "GET") {
      const f = files.get(p);
      return f ? new Response(JSON.stringify({ sha: f.sha, content: f.content, encoding: "base64" }), { status: 200 }) : new Response("{}", { status: 404 });
    }
    const body = JSON.parse(String(init?.body));
    const existing = files.get(p);
    if (existing && body.sha !== existing.sha) return new Response(JSON.stringify({ message: "sha mismatch" }), { status: 409 });
    files.set(p, { sha: `sha-${files.size + 1}-${Date.now()}`, content: body.content });
    return new Response(JSON.stringify({ content: { sha: files.get(p)!.sha } }), { status: existing ? 200 : 201 });
  }) as typeof fetch;
  return { files, calls, fetchFn };
}

describe("GitHub-backed persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "supertools-backup-"));
    process.env.DATA_DIR = path.relative(process.cwd(), dir) || dir;
    process.env.GITHUB_DATA_REPO = "omnifi/supertools-data";
    process.env.GITHUB_DATA_TOKEN = "ghp_test_not_real";
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });
  afterEach(() => {
    for (const k of ["DATA_DIR", "GITHUB_DATA_REPO", "GITHUB_DATA_TOKEN"]) delete process.env[k];
    rmSync(dir, { recursive: true, force: true });
  });

  it("pushes a snapshot, updates it with the sha on the next push, and restores it into an empty store", async () => {
    const gh = fakeGithub();
    const { store } = await import("@/lib/server/store");
    const { backupNow, backupStatus } = await import("@/lib/server/github-backup");
    expect(backupStatus().configured).toBe(true);
    await store().recordUsage({ at: Date.now(), tool: "merge-pdf", ok: true, ms: 120, files: 2, cancelled: false, user: "priya@example.com" });
    await store().recordAudit({ at: Date.now(), actor: "priya@example.com", action: "ai.summarize", detail: "100 chars, 900 ms, openai/gpt-oss-120b, 50+20 tok" });
    expect(await backupNow("test", gh.fetchFn)).toBe(true);
    expect(gh.files.has("snapshot.json")).toBe(true);
    const first = gh.files.get("snapshot.json")!.sha;
    expect(await backupNow("test-2", gh.fetchFn)).toBe(true);
    expect(gh.files.get("snapshot.json")!.sha).not.toBe(first); // second push carried the sha and replaced the file
    expect(backupStatus().lastBackupAt).toBeGreaterThan(0);
    expect(backupStatus().lastError).toBeUndefined();

    // Fresh process with an empty store: restore pulls the usage back.
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
    const { store: store2 } = await import("@/lib/server/store");
    const { restoreOnBoot, backupStatus: status2 } = await import("@/lib/server/github-backup");
    expect((await store2().snapshot()).usage).toHaveLength(0);
    expect(await restoreOnBoot(gh.fetchFn)).toBe(true);
    const snap = await store2().snapshot();
    expect(snap.usage).toHaveLength(1);
    expect(snap.usage[0].user).toBe("priya@example.com");
    expect(snap.audit).toHaveLength(1);
    expect(status2().restoredAt).toBeGreaterThan(0);
  });

  it("does not overwrite a store that already has data, and records errors instead of throwing", async () => {
    const gh = fakeGithub();
    const { store } = await import("@/lib/server/store");
    const { restoreOnBoot, backupNow, backupStatus } = await import("@/lib/server/github-backup");
    gh.files.set("snapshot.json", { sha: "x", content: Buffer.from(JSON.stringify({ usage: [{ at: 1, tool: "x", ok: true, ms: 1, files: 0, cancelled: false }], audit: [], users: {} })).toString("base64") });
    await store().recordUsage({ at: Date.now(), tool: "split-pdf", ok: true, ms: 10, files: 1, cancelled: false, user: "a@b.c" });
    expect(await restoreOnBoot(gh.fetchFn)).toBe(false);
    expect((await store().snapshot()).usage[0].tool).toBe("split-pdf");
    process.env.GITHUB_DATA_TOKEN = "wrong";
    vi.resetModules();
    const m = await import("@/lib/server/github-backup");
    expect(await m.backupNow("test", gh.fetchFn)).toBe(false);
    expect(m.backupStatus().lastError).toMatch(/401/);
    void backupNow; void backupStatus;
  });

  it("builds the daily Excel with people, events and AI sheets", async () => {
    const { store } = await import("@/lib/server/store");
    const { buildExcel } = await import("@/lib/server/github-backup");
    await store().recordUsage({ at: Date.now(), tool: "merge-pdf", ok: true, ms: 5, files: 1, cancelled: false, user: "rahul@example.com" });
    await store().recordUsage({ at: Date.now(), tool: "ai-summarize", ok: true, ms: 5, files: 0, cancelled: false, user: "rahul@example.com" });
    const { name, bytes } = await buildExcel(Date.UTC(2026, 10, 11, 18, 30)); // 00:00 IST on 12 Nov
    expect(name).toBe("exports/usage-2026-11-12.xlsx");
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["People summary", "People x tools", "Events", "AI usage", "Feedback", "Users"]);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["People summary"], { header: 1 });
    expect(rows[1].slice(0, 5)).toEqual(["rahul@example.com", 2, 2, 1, 1]);
  });
});
