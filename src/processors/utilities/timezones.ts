import { ProcessorError } from "@/types/processor";

/** Common abbreviations people type, mapped to IANA zones. */
export const ZONE_ALIASES: Record<string, string> = {
  IST: "Asia/Kolkata",
  INDIA: "Asia/Kolkata",
  EST: "America/New_York",
  EDT: "America/New_York",
  ET: "America/New_York",
  EASTERN: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  CT: "America/Chicago",
  CENTRAL: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  MT: "America/Denver",
  MOUNTAIN: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  PT: "America/Los_Angeles",
  PACIFIC: "America/Los_Angeles",
  AKST: "America/Anchorage",
  HST: "Pacific/Honolulu",
  GMT: "Etc/GMT",
  UTC: "Etc/UTC",
  BST: "Europe/London",
  UK: "Europe/London",
  LONDON: "Europe/London",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EET: "Europe/Athens",
  MSK: "Europe/Moscow",
  GST: "Asia/Dubai",
  DUBAI: "Asia/Dubai",
  UAE: "Asia/Dubai",
  PKT: "Asia/Karachi",
  BDT: "Asia/Dhaka",
  SGT: "Asia/Singapore",
  SINGAPORE: "Asia/Singapore",
  HKT: "Asia/Hong_Kong",
  CHINA: "Asia/Shanghai",
  JST: "Asia/Tokyo",
  TOKYO: "Asia/Tokyo",
  KST: "Asia/Seoul",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
  SYDNEY: "Australia/Sydney",
  AWST: "Australia/Perth",
  NZST: "Pacific/Auckland",
  NZDT: "Pacific/Auckland",
  SAST: "Africa/Johannesburg",
  WAT: "Africa/Lagos",
  BRT: "America/Sao_Paulo",
  ART: "America/Argentina/Buenos_Aires",
  MANILA: "Asia/Manila",
  PHT: "Asia/Manila",
};

export const ZONE_PRESETS = ["Asia/Kolkata", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export const ZONE_OPTIONS = [
  ["Asia/Kolkata", "India (IST)"],
  ["America/New_York", "US Eastern (ET)"],
  ["America/Chicago", "US Central (CT)"],
  ["America/Denver", "US Mountain (MT)"],
  ["America/Phoenix", "Arizona (no DST)"],
  ["America/Los_Angeles", "US Pacific (PT)"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["America/Toronto", "Toronto"],
  ["America/Vancouver", "Vancouver"],
  ["America/Mexico_City", "Mexico City"],
  ["America/Sao_Paulo", "São Paulo"],
  ["Etc/UTC", "UTC"],
  ["Europe/London", "London (GMT/BST)"],
  ["Europe/Dublin", "Dublin"],
  ["Europe/Paris", "Paris / Berlin (CET)"],
  ["Europe/Madrid", "Madrid"],
  ["Europe/Amsterdam", "Amsterdam"],
  ["Europe/Zurich", "Zurich"],
  ["Europe/Athens", "Athens (EET)"],
  ["Europe/Moscow", "Moscow"],
  ["Africa/Johannesburg", "Johannesburg"],
  ["Africa/Lagos", "Lagos"],
  ["Africa/Nairobi", "Nairobi"],
  ["Asia/Dubai", "Dubai (GST)"],
  ["Asia/Riyadh", "Riyadh"],
  ["Asia/Karachi", "Karachi"],
  ["Asia/Dhaka", "Dhaka"],
  ["Asia/Bangkok", "Bangkok"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Hong_Kong", "Hong Kong"],
  ["Asia/Shanghai", "Shanghai / Beijing"],
  ["Asia/Manila", "Manila"],
  ["Asia/Tokyo", "Tokyo"],
  ["Asia/Seoul", "Seoul"],
  ["Australia/Perth", "Perth"],
  ["Australia/Sydney", "Sydney / Melbourne"],
  ["Pacific/Auckland", "Auckland"],
] as const;

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function resolveZone(input: string): string {
  const s = input.trim();
  if (!s) throw new ProcessorError("Time zone is empty");
  const alias = ZONE_ALIASES[s.toUpperCase().replace(/\s+/g, "")];
  if (alias) return alias;
  // Case-insensitive IANA match ("asia/kolkata")
  const candidate = s.replace(/\s+/g, "_").split("/").map((p) => p.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_")).join("/");
  if (isValidZone(candidate)) return candidate;
  if (isValidZone(s)) return s;
  const utc = s.match(/^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (utc) {
    // Etc/GMT signs are inverted by convention; only whole hours exist there, so use a fixed-offset label.
    const hours = Number(utc[2]);
    const mins = Number(utc[3] ?? 0);
    if (mins === 0 && hours <= 14) return `Etc/GMT${utc[1] === "+" ? "-" : "+"}${hours}`;
  }
  throw new ProcessorError(`Unknown time zone "${input}"`, "Use an abbreviation (IST, EST, PST, CET) or an IANA name (America/New_York).");
}

function parts(date: Date, zone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const map: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") map[p.type] = Number(p.value);
  return map;
}

/** Offset of a zone at an instant, in minutes east of UTC. */
export function zoneOffsetMinutes(date: Date, zone: string): number {
  const p = parts(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Interpret a wall-clock time in a zone and return the instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, zone: string): Date {
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  for (let i = 0; i < 3; i++) {
    const off = zoneOffsetMinutes(guess, zone);
    const next = new Date(Date.UTC(y, mo - 1, d, h, mi) - off * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

export function parseLocalDateTime(input: string, zone: string): Date | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?$/i);
  let y: number, mo: number, d: number, h = 9, mi = 0, ampm: string | undefined;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4]) { h = +m[4]; mi = +m[5]; ampm = m[6]; } }
  else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i);
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (m[4]) { h = +m[4]; mi = +m[5]; ampm = m[6]; } }
    else {
      m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i); // time only: today in that zone
      if (!m) return null;
      const today = parts(new Date(), zone);
      y = today.year; mo = today.month; d = today.day; h = +m[1]; mi = +m[2]; ampm = m[3];
    }
  }
  if (ampm) { const p = ampm.toLowerCase(); if (p === "pm" && h < 12) h += 12; if (p === "am" && h === 12) h = 0; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToUtc(y, mo, d, h, mi, zone);
}

export function convertBetweenZones(instant: Date, zone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" });
  const p = f.formatToParts(instant);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const formatted = `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
  const off = zoneOffsetMinutes(instant, zone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const local = parts(instant, zone);
  const dayNumber = Math.floor(Date.UTC(local.year, local.month - 1, local.day) / 86400000);
  return { formatted, offset, abbreviation: get("timeZoneName"), dayNumber };
}
