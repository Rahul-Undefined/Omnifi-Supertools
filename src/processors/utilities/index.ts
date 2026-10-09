import type { CalcProcessor } from "@/types/processor";
import { ProcessorError } from "@/types/processor";
import { formatNumber } from "@/lib/utils";
import { fileFromText } from "../shared/output";
export { unitConvert, dateMath } from "./units";
import { resolveZone, convertBetweenZones, parseLocalDateTime, ZONE_PRESETS } from "./timezones";

/* ---------------- Time zone converter ---------------- */

export const timezone: CalcProcessor = async ({ options }) => {
  const fromZone = resolveZone(String(options.fromCustom || options.from || "America/New_York"));
  const raw = String(options.datetime ?? "").trim();
  const targets = String(options.to ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(resolveZone);
  if (!targets.length) throw new ProcessorError("Add at least one target time zone", "Examples: EST, America/New_York, Europe/London, IST");

  const instant = raw ? parseLocalDateTime(raw, fromZone) : new Date();
  if (!instant) throw new ProcessorError(`Could not read "${raw}"`, "Use a format like 2026-03-01 14:30 or 03/01/2026 2:30 PM");

  const source = convertBetweenZones(instant, fromZone);
  const rows = targets.map((z) => {
    const r = convertBetweenZones(instant, z);
    const dayDiff = r.dayNumber - source.dayNumber;
    return { zone: z, local: r.formatted, offset: r.offset, abbreviation: r.abbreviation, dayDifference: dayDiff === 0 ? "same day" : dayDiff > 0 ? `+${dayDiff} day` : `${dayDiff} day` };
  });
  const header = ["Time zone", "Local time", "UTC offset", "Day"];
  const table = rows.map((r) => [r.zone, r.local, r.offset, r.dayDifference]);
  const text = [`${source.formatted} ${source.abbreviation} (${fromZone})`, "", ...rows.map((r) => `${r.zone.padEnd(22)} ${r.local}  ${r.offset}  ${r.dayDifference}`)].join("\n");
  return {
    files: [fileFromText("time-zones.txt", text)],
    text,
    data: { header, rows: table },
    stats: { From: `${source.formatted} ${source.abbreviation}`, Zone: fromZone, Targets: String(targets.length) },
  };
};

export const worldClock: CalcProcessor = async ({ options }) => {
  const zones = (String(options.zones ?? "") || ZONE_PRESETS.join(", ")).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map(resolveZone);
  const now = new Date();
  const rows = zones.map((z) => { const r = convertBetweenZones(now, z); return [z, r.formatted, r.offset, r.abbreviation]; });
  const text = rows.map((r) => `${r[0].padEnd(22)} ${r[1]}  ${r[2]}  ${r[3]}`).join("\n");
  return { files: [], text, data: { header: ["Time zone", "Local time", "UTC offset", "Abbrev."], rows }, stats: { UTC: now.toISOString().slice(0, 16).replace("T", " ") } };
};

/* ---------------- Currency converter ---------------- */

interface RatesResponse { base: string; rates: Record<string, number>; updated: string; provider: string; nextUpdate?: string }

let cache: { at: number; data: RatesResponse } | null = null;

async function getRates(): Promise<RatesResponse> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const res = await fetch("/api/rates", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProcessorError(data.error ?? "Could not load exchange rates", data.hint);
  cache = { at: Date.now(), data };
  return data;
}

export const currency: CalcProcessor = async ({ options }) => {
  const amount = Number(options.amount ?? 1);
  if (!isFinite(amount)) throw new ProcessorError("Enter an amount");
  const from = String(options.fromCustom || options.from || "USD").trim().toUpperCase();
  const targets = String(options.to ?? "").split(/[\n,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!targets.length) throw new ProcessorError("Add at least one target currency", "Examples: INR, EUR, GBP");
  const rates = await getRates();
  const r = (code: string) => {
    const v = code === rates.base ? 1 : rates.rates[code];
    if (!v) throw new ProcessorError(`Unknown currency code "${code}"`, "Use ISO codes such as USD, INR, EUR, GBP, AED.");
    return v;
  };
  const fromRate = r(from);
  const rows = targets.map((code) => {
    const rate = r(code) / fromRate;
    return [code, formatNumber(amount * rate, 2), formatNumber(rate, 6), formatNumber(1 / rate, 6)];
  });
  const text = [`${formatNumber(amount, 2)} ${from} =`, ...rows.map((row) => `  ${row[1]} ${row[0]}   (1 ${from} = ${row[2]} ${row[0]})`), "", `Rates: ${rates.provider}, updated ${rates.updated}`].join("\n");
  return {
    files: [],
    text,
    data: { header: ["Currency", `Amount (${formatNumber(amount, 2)} ${from})`, `1 ${from} =`, `1 unit in ${from}`], rows },
    stats: { From: `${formatNumber(amount, 2)} ${from}`, Updated: rates.updated, Source: rates.provider },
  };
};
