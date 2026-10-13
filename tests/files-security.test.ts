import { describe, it, expect } from "vitest";
import { detectMime, validateFile, mimeForExt } from "@/lib/files";
import { safeFileName, formatBytes, percentSaved, withSuffix } from "@/lib/utils";
import { zip, unzip, split, merge, hash, detectType, duplicates, base64 } from "@/processors/file";
import { isPrivateAddress, parseTarget } from "@/lib/server/ssrf";
import { rateLimit } from "@/lib/server/ratelimit";
import { hashPassword } from "@/lib/server/auth";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });
const bytes = (arr: number[]) => new Uint8Array(arr);

describe("file type detection", () => {
  it("detects by magic number", () => {
    expect(detectMime(bytes([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(detectMime(bytes([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(detectMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectMime(bytes([0x50, 0x4b, 0x03, 0x04]))).toBe("application/zip");
    expect(detectMime(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectMime(bytes([1, 2, 3]))).toBeNull();
  });
  it("validates against accepted types, size and disguised content", async () => {
    const pdf = new File([bytes([0x25, 0x50, 0x44, 0x46])], "a.pdf", { type: "application/pdf" });
    expect(await validateFile(pdf, ["pdf"], 1000)).toEqual({ ok: true });
    expect((await validateFile(pdf, ["image/*"], 1000)) as { ok: boolean }).toMatchObject({ ok: false });
    expect(await validateFile(pdf, ["pdf"], 2)).toMatchObject({ ok: false, reason: expect.stringMatching(/larger/) });
    expect(await validateFile(new File([], "empty.pdf"), ["pdf"], 1000)).toMatchObject({ ok: false, reason: "File is empty" });
    const fakePng = new File([bytes([0x25, 0x50, 0x44, 0x46])], "evil.png", { type: "image/png" });
    expect(await validateFile(fakePng, ["image/png"], 1000)).toMatchObject({ ok: false, reason: expect.stringMatching(/do not match/) });
    expect(await validateFile(pdf, ["*"], 1000)).toEqual({ ok: true });
    expect(mimeForExt("xlsx")).toContain("spreadsheet");
  });
});

describe("file name safety and formatting", () => {
  it("strips path separators and control characters", () => {
    const traversal = safeFileName("../../etc/passwd");
    expect(traversal).not.toMatch(/[\/]/);
    expect(traversal).not.toContain("..");
    expect(safeFileName("a\u0000b:c*d?.txt")).toBe("a_b_c_d_.txt");
    expect(safeFileName("")).toBe("download");
    expect(safeFileName("x".repeat(300)).length).toBe(180);
  });
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25.7 * 1024 * 1024)).toBe("25.7 MB");
    expect(percentSaved(24.5, 7.2)).toBe("70.6%");
    expect(withSuffix("report.final.pdf", "-compressed")).toBe("report.final-compressed.pdf");
  });
});

describe("file processors", () => {
  it("zips and unzips, guarding traversal", async () => {
    const a = new File(["hello"], "a.txt", { type: "text/plain" });
    const b = new File(["world"], "b.txt", { type: "text/plain" });
    const z = await zip([a, b], ctx({ level: "6" }));
    expect(z.files[0].name).toBe("archive.zip");
    const u = await unzip([new File([z.files[0].blob], "archive.zip", { type: "application/zip" })], ctx());
    expect(u.files.map((f) => f.name).sort()).toEqual(["a.txt", "b.txt"]);
    expect(await u.files[0].blob.text()).toBe("hello");
    await expect(unzip([new File([bytes([1, 2, 3])], "bad.zip")], ctx())).rejects.toThrow(/not a valid ZIP/);
  });
  it("splits and merges files", async () => {
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.bin");
    const s = await split([big], ctx({ chunkMb: 1 }));
    expect(s.stats?.Parts).toBe("3");
    const parts = await unzip([new File([s.files[0].blob], "parts.zip", { type: "application/zip" })], ctx());
    const m = await merge(parts.files.map((p) => new File([p.blob], p.name)), ctx({ name: "big.bin" }));
    expect(m.files[0].bytes).toBe(big.size);
    await expect(split([new File(["x"], "tiny.txt")], ctx({ chunkMb: 1 }))).rejects.toThrow(/smaller/);
  });
  it("hashes, detects types and finds duplicates", async () => {
    const f = new File(["abc"], "abc.txt", { type: "text/plain" });
    const h = await hash([f], ctx());
    expect((h.data as { sha256: string }).sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const d = await detectType([new File([bytes([0x25, 0x50, 0x44, 0x46])], "doc.pdf", { type: "application/pdf" })], ctx());
    expect((d.data as { matchesExtension: boolean }).matchesExtension).toBe(true);
    const dup = await duplicates([f, new File(["abc"], "copy.txt"), new File(["xyz"], "other.txt")], ctx());
    expect(dup.stats?.["Duplicate groups"]).toBe("1");
    expect((await base64([f], ctx({ dataUri: true }))).text).toBe("data:text/plain;base64,YWJj");
  });
});

describe("server security primitives", () => {
  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
  it("rejects dangerous targets before any network call", () => {
    expect(() => parseTarget("file:///etc/passwd")).toThrow(/http/);
    expect(() => parseTarget("http://user:pw@example.com")).toThrow(/Credentials/);
    expect(() => parseTarget("http://localhost:3000")).toThrow(/blocked/);
    expect(() => parseTarget("http://db.internal")).toThrow(/blocked/);
    expect(() => parseTarget("not a url at all")).toThrow(/valid URL/);
    expect(parseTarget("example.com/path").href).toBe("https://example.com/path");
  });
  it("rate limits per key", async () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3)).ok).toBe(true);
    const blocked = await rateLimit(key, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
  it("hashes passwords with scrypt", () => {
    const h = hashPassword("secret");
    expect(h).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(hashPassword("secret")).not.toBe(h); // salted
  });
});
