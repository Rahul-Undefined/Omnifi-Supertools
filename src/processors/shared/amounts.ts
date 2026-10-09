export type DecimalStyle = "auto" | "dot" | "comma";

/**
 * Parse messy money strings: "$1,234.50", "(500.00)", "1.234,50", "500 CR",
 * "-1,000", "USD 12", "12.5-" -> number or null.
 */
export function parseAmount(input: unknown, style: DecimalStyle = "auto"): number | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") return isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) negative = true;
  if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ""); }
  s = s.replace(/\b(CR|DR|USD|EUR|GBP|INR|CAD|AUD)\b/gi, "");
  s = s.replace(/[^\d.,\-+]/g, "");
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!s) return null;

  let decimal: "dot" | "comma";
  if (style !== "auto") decimal = style;
  else {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? "dot" : "comma";
    else if (lastComma >= 0) {
      // "1,234" (thousands) vs "12,50" (decimal): decimal if exactly 2 digits follow and only one comma
      const after = s.length - lastComma - 1;
      decimal = after === 2 && (s.match(/,/g) ?? []).length === 1 ? "comma" : "dot";
    } else decimal = "dot";
  }
  const normalized = decimal === "dot" ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
