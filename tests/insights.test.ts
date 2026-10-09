import { describe, it, expect } from "vitest";
import { aiSignals } from "@/processors/insights/ai-signals";
import { readabilityReport } from "@/processors/insights/readability";
import { similarityReport } from "@/processors/insights/similarity";
import { passwordStrength, generatePassword } from "@/processors/insights/password";
import { cleanEmails } from "@/processors/insights/emails";
import { generateRows } from "@/processors/insights/dummy";
import { markdownToPdf } from "@/processors/insights";
import { PDFDocument } from "pdf-lib";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

const HUMAN = "Honestly, I didn't expect the close to take this long. We had 3 entities, 2 of them with messy bank feeds, and I spent most of Tuesday fixing a $412.50 variance that turned out to be a duplicated Uber charge. My manager said we'd fix the process next quarter. Fine. But last week it happened again, and I'm starting to think the problem isn't the feed, it's us. Anyway, I rewrote the reconciliation checklist. It's shorter now. Four steps instead of eleven. Let's see if anyone actually follows it this time, because I've got my doubts and a lot of coffee.";
const AI = "In today's fast-paced business landscape, it is important to note that organizations must leverage robust solutions to navigate the complexities of financial reporting. Furthermore, a comprehensive approach fosters seamless collaboration across teams. Additionally, embracing cutting-edge technology serves as a testament to an organization's commitment to excellence. Moreover, stakeholders benefit from a holistic understanding of key metrics. In conclusion, by delving into a myriad of strategies, companies can unlock unprecedented value and elevate their performance. Ultimately, this ever-evolving journey underscores the pivotal role of innovation in the realm of modern finance.";

describe("AI-writing signals", () => {
  it("scores stock-phrase-heavy text higher than concrete personal text", () => {
    const a = aiSignals(AI);
    const h = aiSignals(HUMAN);
    expect(a.score).toBeGreaterThan(h.score + 25);
    expect(a.signals.find((s) => s.name === "Stock phrases")?.verdict).toBe("AI-like");
    expect(h.signals.find((s) => s.name === "Personal and concrete detail")?.verdict).toBe("human-like");
    expect(a.note).toMatch(/not proof/);
  });
});

describe("readability", () => {
  it("reports scores and brand violations", () => {
    const r = readabilityReport("We leverage robust synergy to deliver value. The report was written by the team. It is done.");
    expect(r.brandHits.map((h) => h.word).sort()).toEqual(["leverage", "robust", "synergy"]);
    expect(r.passive).toBeGreaterThanOrEqual(1);
    expect(r.fleschEase).toBeGreaterThan(0);
    expect(readabilityReport("Cats sit. Dogs run.").grade).toBeLessThan(3);
  });
});

describe("similarity", () => {
  it("finds copied passages", () => {
    const a = "The quarterly close process requires careful reconciliation of every bank account before the trial balance is finalized and shared with leadership.";
    const b = "Our notes: the quarterly close process requires careful reconciliation of every bank account before anything else happens, per the controller.";
    const r = similarityReport(a, b);
    expect(r.sharedShingles).toBeGreaterThan(5);
    expect(r.longest.length).toBeGreaterThanOrEqual(12);
    expect(r.passages[0]).toContain("quarterly close process");
    expect(similarityReport("alpha beta gamma", "delta epsilon zeta").overall).toBe(0);
  });
});

describe("passwords", () => {
  it("rates strength and generates strong ones", () => {
    expect(passwordStrength("password123").score).toBeLessThanOrEqual(1);
    expect(passwordStrength("correct-horse-Battery-staple-42!").score).toBeGreaterThanOrEqual(3);
    const p = generatePassword(20, { symbols: true, digits: true, passphrase: false });
    expect(p).toHaveLength(20);
    expect(passwordStrength(p).score).toBeGreaterThanOrEqual(3);
    const pp = generatePassword(24, { symbols: false, digits: true, passphrase: true });
    expect(pp.split("-").length).toBeGreaterThanOrEqual(4);
  });
});

describe("email cleaner", () => {
  it("validates, dedupes, fixes typos and strips roles", () => {
    const r = cleanEmails("Rahul <rahul@myomnifi.com>, RAHUL@myomnifi.com; jo..hn@x.com, jane@gmial.com, info@acme.com, temp@mailinator.com", { dropRoles: true, dropDisposable: true });
    expect(r.valid).toEqual(["rahul@myomnifi.com", "jane@gmail.com"]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual(["jo..hn@x.com"]);
    expect(r.removed.sort()).toEqual(["info@acme.com", "temp@mailinator.com"]);
  });
});

describe("test data + markdown", () => {
  it("generates deterministic rows with a seed", () => {
    const a = generateRows("transactions", 20, 42);
    const b = generateRows("transactions", 20, 42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(21);
    expect(generateRows("invoices", 5)[0]).toContain("Due Date");
  });
  it("renders markdown to a PDF", async () => {
    const out = await markdownToPdf("# Close checklist\n\nSome **bold** text.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```", ctx({ title: "Checklist" }));
    const doc = await PDFDocument.load(await out.files[0].blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
    expect(out.files[0].name).toBe("checklist.pdf");
  });
});
