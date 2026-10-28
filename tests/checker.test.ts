import { describe, it, expect } from "vitest";
import { Rng, inputKinds, ledgerCsv, LEDGER_HEADER, jwtSample, wavFile } from "@/lib/checker/fixtures";
import { toCsv, shouldSkip, type CheckResult } from "@/lib/checker/run";
import { tools } from "@/tools/registry";

describe("tool checker fixtures", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.int(1, 100), a.words(3), a.date()]).toEqual([b.int(1, 100), b.words(3), b.date()]);
    expect(new Rng(43).int(1, 1_000_000)).not.toBe(new Rng(42).int(1, 1_000_000));
  });

  it("builds a ledger CSV with the columns the finance tools expect", () => {
    const csv = ledgerCsv(new Rng(7), 5, { dupes: true });
    const lines = csv.split("\n");
    expect(lines[0]).toBe(LEDGER_HEADER.join(","));
    expect(lines).toHaveLength(1 + 5 + 2);
    expect(lines[6]).toBe(lines[1]); // duplicate appended
  });

  it("produces a decodable JWT and a valid WAV header", () => {
    const [h, p] = jwtSample(new Rng(1)).split(".");
    expect(JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/"))).alg).toBe("HS256");
    expect(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).name).toMatch(/\w+ \w+/);
    const wav = wavFile(new Rng(2), 1);
    expect(wav.size).toBe(44 + 16000 * 2);
  });

  it("knows how to generate input for every ready file tool", () => {
    const missing = tools.filter((t) => t.status === "ready" && t.kind === "file" && inputKinds(t).length === 0).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it("skips coming-soon, custom and AI tools according to the options", () => {
    const opts = { seed: 1, includeServer: false, includeAi: false, includeMedia: true, includeOcr: true };
    const custom = tools.find((t) => t.kind === "custom")!;
    expect(shouldSkip(custom, opts, [custom.processor])?.status).toBe("manual");
    expect(shouldSkip(custom, opts, [])?.status).toBe("fail");
    const ai = tools.find((t) => t.processor.startsWith("ai."))!;
    expect(shouldSkip(ai, opts, [])?.status).toBe("skipped");
    expect(shouldSkip(ai, { ...opts, includeAi: true }, [])).toBeNull();
    const soon = tools.find((t) => t.status === "coming-soon")!;
    expect(shouldSkip(soon, opts, [])?.status).toBe("skipped");
  });

  it("exports CSV with quoting", () => {
    const r: CheckResult = { id: "x", name: "X, tool", category: "text", kind: "text", runtime: "browser", status: "pass", ms: 3, input: 'say "hi"', output: "", comment: "ok" };
    const csv = toCsv([r]);
    expect(csv.split("\n")[1]).toBe('x,"X, tool",text,text,browser,pass,3,"say ""hi""",,ok');
  });
});
