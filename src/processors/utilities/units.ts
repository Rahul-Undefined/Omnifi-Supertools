import type { CalcProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { formatNumber } from "@/lib/utils";
import { parseDate, formatDate } from "../shared/dates";

/** Factor to the category's base unit. Temperature handled separately. */
const UNITS: Record<string, Record<string, { f: number; names: string[] }>> = {
  length: { m: { f: 1, names: ["meter", "metre", "m"] }, km: { f: 1000, names: ["kilometer", "km"] }, cm: { f: 0.01, names: ["centimeter", "cm"] }, mm: { f: 0.001, names: ["millimeter", "mm"] }, mi: { f: 1609.344, names: ["mile", "mi"] }, yd: { f: 0.9144, names: ["yard", "yd"] }, ft: { f: 0.3048, names: ["foot", "feet", "ft"] }, in: { f: 0.0254, names: ["inch", "in"] }, nmi: { f: 1852, names: ["nautical mile", "nmi"] } },
  weight: { kg: { f: 1, names: ["kilogram", "kg"] }, g: { f: 0.001, names: ["gram", "g"] }, mg: { f: 1e-6, names: ["milligram", "mg"] }, lb: { f: 0.45359237, names: ["pound", "lb", "lbs"] }, oz: { f: 0.028349523125, names: ["ounce", "oz"] }, t: { f: 1000, names: ["tonne", "metric ton", "t"] }, ton: { f: 907.18474, names: ["us ton", "short ton", "ton"] }, st: { f: 6.35029318, names: ["stone", "st"] } },
  volume: { l: { f: 1, names: ["liter", "litre", "l"] }, ml: { f: 0.001, names: ["milliliter", "ml"] }, gal: { f: 3.785411784, names: ["gallon", "gal", "us gallon"] }, qt: { f: 0.946352946, names: ["quart", "qt"] }, pt: { f: 0.473176473, names: ["pint", "pt"] }, cup: { f: 0.2365882365, names: ["cup"] }, floz: { f: 0.0295735295625, names: ["fluid ounce", "fl oz", "floz"] }, tbsp: { f: 0.01478676478125, names: ["tablespoon", "tbsp"] }, tsp: { f: 0.00492892159375, names: ["teaspoon", "tsp"] }, m3: { f: 1000, names: ["cubic meter", "m3"] }, ft3: { f: 28.316846592, names: ["cubic foot", "ft3"] } },
  area: { m2: { f: 1, names: ["square meter", "m2", "sqm"] }, km2: { f: 1e6, names: ["square kilometer", "km2"] }, ft2: { f: 0.09290304, names: ["square foot", "sq ft", "sqft", "ft2"] }, yd2: { f: 0.83612736, names: ["square yard", "yd2"] }, acre: { f: 4046.8564224, names: ["acre"] }, ha: { f: 10000, names: ["hectare", "ha"] }, mi2: { f: 2589988.110336, names: ["square mile", "mi2"] } },
  speed: { "m/s": { f: 1, names: ["m/s", "meters per second"] }, "km/h": { f: 1 / 3.6, names: ["km/h", "kph", "kilometers per hour"] }, mph: { f: 0.44704, names: ["mph", "miles per hour"] }, kn: { f: 0.514444, names: ["knot", "knots", "kn"] } },
  data: { b: { f: 1, names: ["byte", "b", "bytes"] }, kb: { f: 1024, names: ["kilobyte", "kb"] }, mb: { f: 1024 ** 2, names: ["megabyte", "mb"] }, gb: { f: 1024 ** 3, names: ["gigabyte", "gb"] }, tb: { f: 1024 ** 4, names: ["terabyte", "tb"] }, bit: { f: 1 / 8, names: ["bit", "bits"] }, mbit: { f: 1e6 / 8, names: ["megabit", "mbit", "mb/s"] } },
  time: { s: { f: 1, names: ["second", "s", "sec"] }, min: { f: 60, names: ["minute", "min"] }, h: { f: 3600, names: ["hour", "h", "hr"] }, d: { f: 86400, names: ["day", "d"] }, wk: { f: 604800, names: ["week", "wk"] }, ms: { f: 0.001, names: ["millisecond", "ms"] } },
  temperature: { c: { f: 1, names: ["celsius", "c", "°c"] }, f: { f: 1, names: ["fahrenheit", "f", "°f"] }, k: { f: 1, names: ["kelvin", "k"] } },
};

function findUnit(category: string, name: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  const table = UNITS[category];
  for (const [key, u] of Object.entries(table)) if (key === n || u.names.includes(n) || u.names.includes(n.replace(/s$/, ""))) return key;
  throw new ProcessorError(`Unknown ${category} unit "${name}"`, `Try one of: ${Object.keys(table).join(", ")}`);
}

function convertTemp(v: number, from: string, to: string): number {
  const c = from === "c" ? v : from === "f" ? (v - 32) * (5 / 9) : v - 273.15;
  return to === "c" ? c : to === "f" ? c * (9 / 5) + 32 : c + 273.15;
}

export function convert(category: string, value: number, from: string, to: string): number {
  const a = findUnit(category, from);
  const b = findUnit(category, to);
  if (category === "temperature") return convertTemp(value, a, b);
  return (value * UNITS[category][a].f) / UNITS[category][b].f;
}

export const unitConvert: CalcProcessor = async ({ options }) => {
  const category = String(options.category ?? "length");
  if (!UNITS[category]) throw new ProcessorError("Pick a category");
  const value = Number(options.value);
  if (!isFinite(value)) throw new ProcessorError("Enter a number");
  const from = String(options.from ?? "");
  const toRaw = String(options.to ?? "").trim();
  const fromKey = findUnit(category, from);
  const targets = toRaw ? toRaw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : Object.keys(UNITS[category]).filter((k) => k !== fromKey);
  const rows = targets.map((t) => { const r = convert(category, value, from, t); return [findUnit(category, t), formatNumber(r, Math.abs(r) < 1 ? 6 : 4)]; });
  const text = rows.map((r) => `${formatNumber(value, 4)} ${fromKey} = ${r[1]} ${r[0]}`).join("\n");
  return { files: [], text, data: { header: ["Unit", `${formatNumber(value, 4)} ${fromKey} =`], rows }, stats: { From: `${formatNumber(value, 4)} ${fromKey}` } };
};

/* ---------------- Date math ---------------- */

export function fiscalQuarter(d: Date, fyStartMonth: number) {
  const m = d.getUTCMonth() + 1;
  const offset = (m - fyStartMonth + 12) % 12;
  const q = Math.floor(offset / 3) + 1;
  const fy = fyStartMonth === 1 ? d.getUTCFullYear() : m >= fyStartMonth ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const qStartMonth = ((fyStartMonth - 1 + (q - 1) * 3) % 12) + 1;
  const qStartYear = qStartMonth > m ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const start = new Date(Date.UTC(qStartYear, qStartMonth - 1, 1));
  const end = new Date(Date.UTC(qStartYear, qStartMonth + 2, 0));
  return { q, fy, start, end };
}

export const dateMath: CalcProcessor = async ({ options }) => {
  const mode = String(options.mode ?? "between");
  const fmt = "mm/dd/yyyy";
  const a = parseDate(String(options.start || ""), "mdy") ?? new Date();
  if (mode === "between") {
    const b = parseDate(String(options.end || ""), "mdy");
    if (!b) throw new ProcessorError("Enter the end date (mm/dd/yyyy)");
    const days = Math.round((b.getTime() - a.getTime()) / 86400000);
    const weeks = Math.floor(Math.abs(days) / 7);
    let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) months -= 1;
    const rows: [string, string][] = [["From", formatDate(a, fmt)], ["To", formatDate(b, fmt)], ["Days", String(days)], ["Weeks + days", `${weeks} wk ${Math.abs(days) % 7} d`], ["Whole months", String(months)], ["Years", (days / 365.25).toFixed(2)]];
    return { files: [], text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"), data: { days }, stats: Object.fromEntries(rows) };
  }
  if (mode === "add") {
    const n = Number(options.amount ?? 0);
    const unit = String(options.unit ?? "days");
    const r = new Date(a);
    if (unit === "days") r.setUTCDate(r.getUTCDate() + n);
    else if (unit === "weeks") r.setUTCDate(r.getUTCDate() + n * 7);
    else if (unit === "months") r.setUTCMonth(r.getUTCMonth() + n);
    else r.setUTCFullYear(r.getUTCFullYear() + n);
    const weekday = r.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const rows: [string, string][] = [["Start", formatDate(a, fmt)], [`${n >= 0 ? "+" : ""}${n} ${unit}`, `${formatDate(r, fmt)} (${weekday})`]];
    return { files: [], text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"), data: { date: r.toISOString() }, stats: Object.fromEntries(rows) };
  }
  const fyStart = Number(options.fyStart ?? 1);
  const { q, fy, start, end } = fiscalQuarter(a, fyStart);
  const calQ = Math.floor(a.getUTCMonth() / 3) + 1;
  const dayOfYear = Math.floor((a.getTime() - Date.UTC(a.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const rows: [string, string][] = [["Date", formatDate(a, fmt)], ["Fiscal quarter", `Q${q} FY${fy}`], ["Quarter runs", `${formatDate(start, fmt)} to ${formatDate(end, fmt)}`], ["Calendar quarter", `Q${calQ} ${a.getUTCFullYear()}`], ["Day of year", String(dayOfYear)], ["Week of year", String(Math.ceil(dayOfYear / 7))]];
  return { files: [], text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"), data: { q, fy }, stats: Object.fromEntries(rows) };
};
