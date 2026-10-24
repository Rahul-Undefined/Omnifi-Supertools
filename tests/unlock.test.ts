import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { unlock } from "../src/processors/pdf/advanced";

/** Fixtures were generated with pypdf: user password 11121966 (owner-only.pdf has an empty user password). */
const dir = path.join(__dirname, "fixtures", "encrypted");
const load = (name: string) => new File([readFileSync(path.join(dir, name))], name, { type: "application/pdf" });
const ctx = (password: string) => ({ options: { password } });
const latin1 = async (f: { blob: Blob }) => new TextDecoder("latin1").decode(new Uint8Array(await f.blob.arrayBuffer()));

describe("Unlock PDF", () => {
  it("removes RC4-40, RC4-128, AES-128, AES-256 (R5 and R6) and object-stream encryption with the right password", async () => {
    for (const name of readdirSync(dir).filter((n) => n !== "plain.pdf" && n !== "owner-only.pdf")) {
      const r = await unlock([load(name)], ctx("11121966"));
      const out = await latin1(r.files[0]);
      expect(out, name).not.toMatch(/\/Encrypt\b/);
      expect(r.files[0].name).toBe(name.replace(".pdf", "-unlocked.pdf"));
      expect(out.length, name).toBeGreaterThan(300);
    }
  });
  it("opens owner-only protection with a blank password and reports a wrong password clearly", async () => {
    const r = await unlock([load("owner-only.pdf")], ctx(""));
    expect(await latin1(r.files[0])).not.toMatch(/\/Encrypt\b/);
    await expect(unlock([load("aes-128.pdf")], ctx("nope"))).rejects.toThrow(/Wrong password/);
    await expect(unlock([load("aes-128.pdf")], ctx(""))).rejects.toThrow(/needs a password/);
  });
  it("passes an unprotected file through with a note", async () => {
    const r = await unlock([load("plain.pdf")], ctx("anything"));
    expect(r.warnings?.[0]).toMatch(/not password protected/);
  });
});
