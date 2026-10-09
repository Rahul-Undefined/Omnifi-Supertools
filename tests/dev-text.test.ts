import { describe, it, expect } from "vitest";
import { jsonFormat, jsonValidate, jsonMinify, xmlFormat, yamlFormat, sqlFormat, regexTest, urlEncode, urlDecode, base64, hash, jwtDecode, timestamp, cron, cssFormat, color, markdown } from "@/processors/dev";
import { count, caseConvert, dedupeLines, sortLines, reverse, diff, clean, whitespace, htmlToMarkdown } from "@/processors/text";
import { describeCron, nextCronRuns } from "@/processors/dev/cron";
import { md5, allHashes } from "@/processors/shared/hash";
import { diffLines } from "@/processors/shared/diff";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

describe("developer tools", () => {
  it("formats, validates and minifies JSON", async () => {
    expect((await jsonFormat('{"b":1,"a":[1,2]}', ctx({ indent: "2", sortKeys: true }))).text).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}');
    await expect(jsonFormat("{bad", ctx())).rejects.toMatchObject({ hint: expect.stringMatching(/Line 1/) });
    expect((await jsonValidate("[1,2]", ctx())).stats?.Status).toBe("Valid");
    expect((await jsonMinify('{ "a" : 1 }', ctx())).text).toBe('{"a":1}');
  });
  it("formats XML and YAML", async () => {
    expect((await xmlFormat("<a><b>x</b><c/></a>", ctx({ indent: "2" }))).text).toBe("<a>\n  <b>x</b>\n  <c/>\n</a>");
    expect((await yamlFormat("a: 1\nb: [1, 2]", ctx({ to: "json" }))).text).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    await expect(yamlFormat("a: [", ctx())).rejects.toThrow(/Invalid YAML/);
  });
  it("formats SQL", async () => {
    const out = (await sqlFormat("select a, b from t where x = 'select' and y = 2 order by a", ctx({ keywordCase: "upper" }))).text!;
    expect(out).toMatch(/^SELECT a,\n  b\nFROM t\nWHERE x = 'select'\n  AND y = 2\nORDER BY a$/);
  });
  it("tests regexes with groups", async () => {
    const out = await regexTest("Paid 2026-03-01 and 2026-04-01", ctx({ pattern: "(\\d{4})-(\\d{2})-\\d{2}", flags: "g" }));
    expect(out.stats?.Matches).toBe("2");
    expect((out.data as { groups: string[] }[])[0].groups).toEqual(["2026", "03"]);
    await expect(regexTest("x", ctx({ pattern: "(" }))).rejects.toThrow(/Invalid/);
  });
  it("encodes and decodes", async () => {
    expect((await urlEncode("a b&c/d", ctx({ component: true }))).text).toBe("a%20b%26c%2Fd");
    expect((await urlDecode("a%20b+c", ctx())).text).toBe("a b c");
    expect((await base64("héllo", ctx({ mode: "encode" }))).text).toBe("aMOpbGxv");
    expect((await base64("aMOpbGxv", ctx({ mode: "decode" }))).text).toBe("héllo");
    expect((await base64("a?b", ctx({ mode: "encode", urlSafe: true }))).text).not.toMatch(/[+/=]/);
    await expect(base64("***", ctx({ mode: "decode" }))).rejects.toThrow(/Base64/);
  });
  it("hashes text and bytes", async () => {
    expect(md5(new TextEncoder().encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(new TextEncoder().encode("The quick brown fox jumps over the lazy dog"))).toBe("9e107d9d372bb6826bd81d3542a419d6");
    const h = await allHashes(new TextEncoder().encode("abc"));
    expect(h.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(h.sha1).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect((await hash("abc", ctx())).text).toContain(h.sha512);
  });
  it("decodes JWTs without verifying", async () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = await jwtDecode(token, ctx());
    expect((out.data as { payload: { name: string } }).payload.name).toBe("John Doe");
    expect(out.stats?.Algorithm).toBe("HS256");
    await expect(jwtDecode("nope", ctx())).rejects.toThrow(/JWT/);
  });
  it("converts timestamps", async () => {
    const out = await timestamp("1735689600", ctx());
    expect((out.data as { iso: string }).iso).toBe("2025-01-01T00:00:00.000Z");
    expect((await timestamp("2025-01-01T00:00:00Z", ctx())).stats?.Unix).toBe("1735689600");
    await expect(timestamp("garbage", ctx())).rejects.toThrow();
  });
  it("explains cron expressions and computes next runs", async () => {
    expect(describeCron("0 9 * * 1-5")).toBe("At 09:00 on weekdays");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("30 8 1 * *")).toBe("At 08:30 on day 1 of the month");
    expect(describeCron("@daily")).toBe("At 00:00");
    const runs = nextCronRuns("0 9 * * 1-5", 3, new Date("2026-03-06T10:00:00")); // Friday
    expect(runs.map((d) => d.getDay())).toEqual([1, 2, 3]);
    expect(() => describeCron("60 * * * *")).toThrow(/out of range/);
    expect((await cron("0 9 * * 1-5", ctx({ count: 2 }))).text).toContain("weekdays");
  });
  it("formats CSS and converts colours", async () => {
    expect((await cssFormat("a{color:red;margin:0}", ctx({ mode: "beautify" }))).text).toBe("a {\n  color:red;\n  margin:0;\n}");
    expect((await cssFormat("a {\n  color: red;\n}", ctx({ mode: "minify" }))).text).toBe("a{color:red}");
    const c = await color("#4F5BD5", ctx());
    expect(c.stats?.RGB).toBe("rgb(79, 91, 213)");
    expect(c.stats?.HSL).toMatch(/^hsl\(235, 6[12]%, 57%\)$/);
    expect((await color("rgb(255,255,255)", ctx())).stats?.HEX).toBe("#FFFFFF");
    await expect(color("blueish", ctx())).rejects.toThrow();
  });
  it("renders markdown", async () => {
    expect((await markdown("# Hi\n\n- a", ctx())).text).toContain("<h1>Hi</h1>");
  });
});

describe("text tools", () => {
  it("counts", async () => {
    const out = await count("Hello world. This is a test!\n\nSecond paragraph here.", ctx());
    expect(out.stats).toMatchObject({ Words: "9", Lines: "3", Sentences: "3", Paragraphs: "2" });
  });
  it("converts case", async () => {
    expect((await caseConvert("hello big world", ctx({ to: "camel" }))).text).toBe("helloBigWorld");
    expect((await caseConvert("helloBigWorld", ctx({ to: "snake" }))).text).toBe("hello_big_world");
    expect((await caseConvert("hello. big world", ctx({ to: "sentence" }))).text).toBe("Hello. Big world");
    expect((await caseConvert("hello big world", ctx({ to: "title" }))).text).toBe("Hello Big World");
  });
  it("dedupes, sorts and reverses lines", async () => {
    expect((await dedupeLines("a\nB\nb\na ", ctx({ caseInsensitive: true, trim: true }))).text).toBe("a\nB");
    expect((await sortLines("b10\nb2\na", ctx({ by: "natural" }))).text).toBe("a\nb2\nb10");
    expect((await sortLines("bb\na\nccc", ctx({ by: "length", desc: true }))).text).toBe("ccc\nbb\na");
    expect((await reverse("a\nb", ctx({ mode: "lines" }))).text).toBe("b\na");
    expect((await reverse("ab\ncd", ctx({ mode: "chars" }))).text).toBe("ba\ndc");
  });
  it("diffs", async () => {
    const out = await diff("a\nb\nc", ctx({ b: "a\nc\nd" }));
    expect(out.stats).toEqual({ Added: "1", Removed: "1", Unchanged: "2" });
    expect(diffLines("", "")).toEqual([{ type: "same", text: "" }]);
  });
  it("cleans and strips whitespace", async () => {
    expect((await clean("“smart”  quotes​\n\n\nx  ", ctx())).text).toBe('"smart" quotes\nx');
    expect((await whitespace("  a  \n b ", ctx({ mode: "all" }))).text).toBe("ab");
    expect((await whitespace("  a  \n b ", ctx({ mode: "trim" }))).text).toBe("a\nb");
  });
  it("converts HTML to Markdown", async () => {
    const out = (await htmlToMarkdown("<h1>Title</h1><p>Some <strong>bold</strong> and <a href='/x'>link</a></p><ul><li>one</li></ul>", ctx())).text!;
    expect(out).toContain("# Title");
    expect(out).toContain("**bold**");
    expect(out).toContain("[link](/x)");
    expect(out).toContain("- one");
  });
});
