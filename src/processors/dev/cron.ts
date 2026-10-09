import { ProcessorError } from "@/types/processor";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ALIASES: Record<string, string> = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

interface Field { values: Set<number>; any: boolean; raw: string }

function parseField(raw: string, min: number, max: number, names?: string[]): Field {
  const values = new Set<number>();
  let any = false;
  for (const part of raw.split(",")) {
    const [rawRange, stepStr] = part.split("/");
    let range = rawRange;
    const step = stepStr ? Number(stepStr) : 1;
    if (!step || step < 1) throw new ProcessorError(`Invalid step in "${part}"`);
    if (names) range = range.replace(/[a-z]{3}/gi, (m) => { const i = names.findIndex((n) => n.slice(0, 3).toLowerCase() === m.toLowerCase()); return i >= 0 ? String(i + (names === MONTHS ? 1 : 0)) : m; });
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; if (!stepStr) any = true; }
    else if (range.includes("-")) { [lo, hi] = range.split("-").map(Number); }
    else { lo = Number(range); hi = stepStr ? max : lo; }
    if ([lo, hi].some((v) => isNaN(v) || v < min || v > max)) throw new ProcessorError(`Value out of range in "${part}"`, `Allowed ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) values.add(v === 7 && max === 7 ? 0 : v);
  }
  return { values, any, raw };
}

export function parseCron(expr: string) {
  const e = ALIASES[expr.trim().toLowerCase()] ?? expr.trim();
  const parts = e.split(/\s+/);
  if (parts.length !== 5) throw new ProcessorError("Expected 5 fields", "minute hour day-of-month month day-of-week");
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTHS),
    dow: parseField(parts[4], 0, 7, DAYS),
  };
}

const list = (vals: number[], fmt: (n: number) => string) => {
  const a = vals.map(fmt);
  return a.length <= 1 ? a[0] ?? "" : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
};
const pad = (n: number) => String(n).padStart(2, "0");

export function describeCron(expr: string): string {
  const c = parseCron(expr);
  const mins = [...c.minute.values].sort((a, b) => a - b);
  const hours = [...c.hour.values].sort((a, b) => a - b);
  let time: string;
  if (c.minute.any && c.hour.any) time = "Every minute";
  else if (c.hour.any) time = mins.length === 1 ? `At minute ${mins[0]} of every hour` : c.minute.raw.startsWith("*/") ? `Every ${c.minute.raw.slice(2)} minutes` : `At minutes ${list(mins, String)} of every hour`;
  else if (c.minute.any) time = `Every minute during hour${hours.length > 1 ? "s" : ""} ${list(hours, String)}`;
  else if (mins.length === 1 && hours.length <= 4) time = `At ${list(hours, (h) => `${pad(h)}:${pad(mins[0])}`)}`;
  else if (c.hour.raw.startsWith("*/")) time = `Every ${c.hour.raw.slice(2)} hours at minute ${mins[0]}`;
  else time = `At minute${mins.length > 1 ? "s" : ""} ${list(mins, String)} past hour${hours.length > 1 ? "s" : ""} ${list(hours, String)}`;
  const parts = [time];
  if (!c.dom.any) parts.push(`on day${c.dom.values.size > 1 ? "s" : ""} ${list([...c.dom.values].sort((a, b) => a - b), String)} of the month`);
  if (!c.dow.any) {
    const d = [...c.dow.values].sort((a, b) => a - b);
    parts.push(d.length === 5 && d.join() === "1,2,3,4,5" ? "on weekdays" : d.length === 2 && d.join() === "0,6" ? "on weekends" : `on ${list(d, (x) => DAYS[x])}`);
  }
  if (!c.month.any) parts.push(`in ${list([...c.month.values].sort((a, b) => a - b), (m) => MONTHS[m - 1])}`);
  return parts.join(" ");
}

export function nextCronRuns(expr: string, count: number, from = new Date()): Date[] {
  const c = parseCron(expr);
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const domRestricted = !c.dom.any;
  const dowRestricted = !c.dow.any;
  for (let i = 0; i < 366 * 24 * 60 && out.length < count; i++) {
    const dayOk = domRestricted && dowRestricted
      ? c.dom.values.has(d.getDate()) || c.dow.values.has(d.getDay())
      : (!domRestricted || c.dom.values.has(d.getDate())) && (!dowRestricted || c.dow.values.has(d.getDay()));
    if (c.month.values.has(d.getMonth() + 1) && dayOk && c.hour.values.has(d.getHours()) && c.minute.values.has(d.getMinutes())) out.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}
