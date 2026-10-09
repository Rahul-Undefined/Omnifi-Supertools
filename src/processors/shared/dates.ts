const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type DateAssumption = "mdy" | "dmy";

/** Parse many common date shapes. Returns null when unsure. */
export function parseDate(input: unknown, assume: DateAssumption = "mdy"): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    // Excel serial date
    if (input > 20000 && input < 80000) return new Date(Date.UTC(1899, 11, 30) + input * 86400000);
    // Unix seconds / ms
    if (input > 1e11) return new Date(input);
    if (input > 1e8) return new Date(input * 1000);
    return null;
  }
  const s = String(input).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return utc(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let month: number, day: number;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (assume === "dmy") { day = a; month = b; }
    else { month = a; day = b; }
    return utc(y, month, day);
  }

  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,})[\s,-]+(\d{2,4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mi >= 0) return utc(y, mi + 1, +m[1]);
  }

  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return utc(+m[3], mi + 1, +m[2]);
  }

  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})$/); // "03 Mar" (no year) -> current year
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return utc(new Date().getUTCFullYear(), mi + 1, +m[1]);
  }

  const t = Date.parse(s);
  if (!isNaN(t) && /\d{4}/.test(s)) return new Date(t);
  return null;
}

function utc(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? dt : null;
}

export function formatDate(d: Date, fmt: string): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const mm = String(m).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const mon = MONTHS[m - 1];
  const Mon = mon[0].toUpperCase() + mon.slice(1);
  switch (fmt) {
    case "mm/dd/yyyy": return `${mm}/${dd}/${y}`;
    case "dd/mm/yyyy": return `${dd}/${mm}/${y}`;
    case "dd mmm yyyy": return `${dd} ${Mon} ${y}`;
    default: return `${y}-${mm}-${dd}`;
  }
}
