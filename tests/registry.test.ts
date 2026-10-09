import { describe, it, expect } from "vitest";
import { tools, getTool, toolsInCategory, relatedTools, toolsAccepting, registryStats, categories } from "@/tools/registry";
import { isImplemented } from "@/processors";

describe("tool registry", () => {
  it("has unique ids", () => {
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every tool belongs to a known category", () => {
    const known = new Set(categories.map((c) => c.id));
    for (const t of tools) expect(known.has(t.category), `${t.id} category`).toBe(true);
  });

  it("every ready tool points at an implemented processor family", () => {
    for (const t of tools.filter((t) => t.status === "ready")) {
      expect(isImplemented(t.processor), `${t.id} -> ${t.processor}`).toBe(true);
    }
  });

  it("coming-soon tools never claim a browser/client processor family", () => {
    for (const t of tools.filter((t) => t.status === "coming-soon")) {
      expect(t.processor.startsWith("server.") || t.processor === "image.barcode" || t.processor === "file.tar" || t.processor === "dev.jsFormat", t.id).toBe(true);
    }
  });

  it("file tools declare inputs; text/calculator tools do not require them", () => {
    for (const t of tools) {
      if (t.kind === "file") expect(t.input.length, `${t.id} input`).toBeGreaterThan(0);
      if (t.kind !== "custom") expect(t.output.length, `${t.id} output`).toBeGreaterThan(0);
      expect(t.keywords.length, `${t.id} keywords`).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it("option defaults match their field types", () => {
    for (const t of tools) {
      for (const o of t.options ?? []) {
        if (o.type === "number" || o.type === "range") expect(typeof o.default, `${t.id}.${o.key}`).toBe("number");
        if (o.type === "checkbox") expect(typeof o.default, `${t.id}.${o.key}`).toBe("boolean");
        if (o.type === "select") expect(o.options.some((x) => x.value === o.default), `${t.id}.${o.key} default in options`).toBe(true);
      }
    }
  });

  it("related tools resolve to real tools", () => {
    for (const t of tools) for (const r of t.related ?? []) expect(getTool(r), `${t.id} -> ${r}`).toBeDefined();
  });

  it("helpers work", () => {
    expect(getTool("merge-pdf")?.name).toBe("Merge PDF");
    expect(toolsInCategory("documents").length).toBeGreaterThan(10);
    expect(toolsInCategory("documents", false).every((t) => t.status === "ready")).toBe(true);
    expect(relatedTools(getTool("merge-pdf")!).map((t) => t.id)).toContain("split-pdf");
    expect(toolsAccepting("pdf").map((t) => t.id)).toContain("compress-pdf");
    expect(toolsAccepting("jpg").map((t) => t.id)).toContain("compress-image");
    const s = registryStats();
    expect(s.ready + s.comingSoon).toBe(s.total);
    expect(s.ready).toBeGreaterThan(100);
  });
});
