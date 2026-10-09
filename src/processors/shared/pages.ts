import { ProcessorError } from "@/types/processor";

/**
 * Parse "1, 3-5, 8" into zero-based page indices, validated against total.
 * Empty input means all pages.
 */
export function parsePageRanges(input: string, total: number): number[] {
  const text = (input ?? "").trim();
  if (!text) return Array.from({ length: total }, (_, i) => i);
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new ProcessorError(`Invalid page reference "${part}"`, "Use numbers and ranges like 1, 3-5");
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > total || b > total) {
      throw new ProcessorError(`Page ${a > total ? a : b} is out of range (document has ${total} pages)`);
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

/** Parse "1-3, 4, 7-9" into a list of inclusive one-based ranges. */
export function parseRangeGroups(input: string, total: number): [number, number][] {
  const text = (input ?? "").trim();
  if (!text) throw new ProcessorError("Enter at least one range", "Example: 1-3, 4, 7-9");
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new ProcessorError(`Invalid range "${part}"`);
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      if (a < 1 || b > total || a > b) throw new ProcessorError(`Range "${part}" is outside 1-${total}`);
      return [a, b] as [number, number];
    });
}
