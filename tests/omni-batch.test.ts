import { describe, expect, it } from "vitest";
import * as text from "../src/processors/text/extra";
import * as data from "../src/processors/data";
import * as nums from "../src/processors/utilities/numbers";

const ctx = (options: Record<string, string | number | boolean> = {}) => ({ options });

describe("text utilities", () => {
  it("find & replace with regex groups, whole word and case", async () => {
    expect((await text.findReplace("Acme Corp and acme corp", ctx({ find: "acme", replace: "Omnifi" }))).text).toBe("Omnifi Corp and Omnifi corp");
    expect((await text.findReplace("cat catalog", ctx({ find: "cat", replace: "dog", wholeWord: true }))).text).toBe("dog catalog");
    expect((await text.findReplace("2025-10-01", ctx({ find: "(\\d{4})-(\\d{2})-(\\d{2})", replace: "$2/$3/$1", regex: true }))).text).toBe("10/01/2025");
  });
  it("detects and cleans hidden characters", async () => {
    const r = await text.hiddenChars("Invoice​ total $5‮", ctx());
    expect(r.stats?.["Hidden characters"]).toBe("3");
    expect((r.data as { cleaned: string }).cleaned).toBe("Invoice total $5");
  });
  it("joins, splits, prefixes, shuffles, rotates, groups", async () => {
    expect((await text.joinLines("a\nb\n\nc", ctx({ separator: ", " }))).text).toBe("a, b, c");
    expect((await text.splitText("a,b,,c", ctx({ separator: "," }))).text).toBe("a\nb\nc");
    expect((await text.prefixSuffix("x\ny", ctx({ prefix: "- ", suffix: ";" }))).text).toBe("- x;\n- y;");
    expect((await text.prefixSuffix("- x;", ctx({ prefix: "- ", suffix: ";", remove: true }))).text).toBe("x");
    expect((await text.shuffleLines("1\n2\n3\n4", ctx({ seed: "abc" }))).text!.split("\n").sort()).toEqual(["1", "2", "3", "4"]);
    expect((await text.rotateList("a\nb\nc", ctx({ by: 1 }))).text).toBe("b\nc\na");
    expect((await text.groupItems("a\nb\nc\nd\ne", ctx({ mode: "size", size: 2 }))).stats?.Groups).toBe("3");
    expect((await text.groupItems("fruit: apple\nveg: kale\nfruit: pear", ctx({ mode: "key" }))).text).toContain("fruit:\napple\npear");
  });
  it("counts frequency, truncates, slugs, converts tables and censors", async () => {
    const f = await text.wordFrequency("tax tax audit Tax", ctx({ minLength: 1 }));
    expect((f.data as { rows: unknown[][] }).rows[0]).toEqual(["tax", 3, "75.0%"]);
    expect((await text.truncateLines("abcdefghij", ctx({ length: 4 }))).text).toBe("abcd…");
    expect((await text.truncateList("a\nb\nc", ctx({ count: 2, side: "last" }))).text).toBe("b\nc");
    expect((await text.slug("Q3 Review: Client Pack (Final)!", ctx())).text).toBe("q3-review-client-pack-final");
    const t = await text.textToTable("Name  Amount\nAcme  100\nGlobex  50", ctx({ output: "csv" }));
    expect(t.text).toBe("Name,Amount\nAcme,100\nGlobex,50");
    expect((await text.censor("The password is hunter2", ctx({ words: "password, hunter2" }))).text).toBe("The ******** is *******");
    expect((await text.rot13("Hello", ctx())).text).toBe("Uryyb");
  });
});

describe("data utilities", () => {
  const csv = "name,amount,active\nAcme,100,true\nGlobex,\"1,200\",false";
  it("converts CSV to JSON/XML/YAML and back", async () => {
    const j = await data.csvToJson(csv, ctx());
    expect(JSON.parse(j.text ?? "")).toEqual([{ name: "Acme", amount: 100, active: true }, { name: "Globex", amount: "1,200", active: false }]);
    const back = await data.jsonToCsv(j.text ?? "", ctx());
    expect(back.text).toContain("name,amount,active\nAcme,100,true");
    expect((await data.csvToXml(csv, ctx({ root: "rows", item: "row" }))).text).toContain("<row>\n    <name>Acme</name>");
    expect((await data.csvToYaml(csv, ctx())).text).toContain("- name: Acme\n  amount: 100");
  });
  it("changes separators, transposes, swaps and inserts columns, finds incomplete rows", async () => {
    expect((await data.changeSeparator(csv, ctx({ to: "semicolon" }))).text!.split("\n")[0]).toBe("name;amount;active");
    expect((await data.transposeCsv("a,b\n1,2", ctx())).text).toBe("a,1\nb,2");
    expect((await data.swapColumns("a,b,c\n1,2,3", ctx({ a: "a", b: "3" }))).text).toBe("c,b,a\n3,2,1");
    expect((await data.insertColumn("a,b\n1,2", ctx({ name: "id", position: "a", where: "before", mode: "index" }))).text).toBe("id,a,b\n1,1,2");
    const inc = await data.incompleteRows("a,b,c\n1,2,3\n4,5\n6,,8", ctx());
    expect(inc.stats?.Incomplete).toBe("2");
    expect((await data.tsvCsv("a,b\n1,2", ctx({ direction: "csv-to-tsv" }))).text).toBe("a\tb\n1\t2");
  });
  it("sorts, escapes and compares JSON; validates XML", async () => {
    expect((await data.jsonSortKeys('{"b":1,"a":{"d":1,"c":2}}', ctx({ minify: true }))).text).toBe('{"a":{"c":2,"d":1},"b":1}');
    expect((await data.jsonEscape('say "hi"\nnow', ctx())).text).toBe('"say \\"hi\\"\\nnow"');
    expect((await data.jsonEscape('"a\\nb"', ctx({ mode: "unescape" }))).text).toBe("a\nb");
    const d = await data.jsonCompare('{"a":1,"b":[1,2],"c":"x"}', ctx({ b: '{"a":2,"b":[1,2,3],"d":true}' }));
    expect(d.stats).toEqual({ Added: "2", Removed: "1", Changed: "1" });
  });
});

describe("number and time utilities", () => {
  it("writes amounts in words for checks and parses them back", async () => {
    expect(nums.amountToWords(1234.56)).toBe("One thousand two hundred thirty-four and 56/100 dollars");
    expect(nums.amountToWords(1000000)).toBe("One million and 00/100 dollars");
    expect(nums.integerToWords(115)).toBe("one hundred fifteen");
    expect(nums.wordsToNumber("two thousand five hundred and seven")).toBe(2507);
    const r = await nums.numberToWords("$2,500.10", ctx());
    expect(r.text).toBe("$2,500.10 → Two thousand five hundred and 10/100 dollars");
  });
  it("computes stats, sequences, random numbers and byte conversions", async () => {
    const s = await nums.numberStats("10, 20, (5), $30", ctx());
    expect(s.stats).toMatchObject({ Count: "4", Sum: "55", Average: "13.75", Median: "15", Min: "-5", Max: "30" });
    expect((await nums.sequence(ctx({ mode: "arithmetic", start: 2, step: 3, count: 4, separator: "comma" }))).text).toBe("2, 5, 8, 11");
    expect((await nums.sequence(ctx({ mode: "primes", count: 5 }))).text).toBe("2\n3\n5\n7\n11");
    const r = await nums.randomNumbers(ctx({ min: 1, max: 6, count: 6, unique: true, sort: true }));
    expect(r.text).toBe("1\n2\n3\n4\n5\n6");
    expect((await nums.byteConverter(ctx({ value: 1, from: "GiB" }))).stats?.Bytes).toBe("1,073,741,824");
  });
  it("converts timesheet times to decimal hours and durations", async () => {
    const t = await nums.timeDecimal("7:45\n1h 30m\n0:20", ctx());
    expect(t.text).toContain("7:45 → 7.75 h");
    expect(t.stats?.Total).toBe("9.58 h");
    expect((await nums.timeDecimal("7.75", ctx({ mode: "toTime" }))).text).toContain("7.75 → 7:45");
    expect((await nums.durationConvert(ctx({ value: 90, from: "minutes" }))).stats?.["As h:mm:ss"]).toBe("1:30:00");
    expect((await nums.leapYear("2024 2025 2100 2000", ctx())).text).toMatch(/2024: leap[\s\S]*2025: not[\s\S]*2100: not[\s\S]*2000: leap/);
  });
});
