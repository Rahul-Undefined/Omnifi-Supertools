import { NextResponse } from "next/server";

/**
 * Live exchange rates, cached server-side for an hour. Source is a fixed,
 * public, keyless feed (ECB-style daily rates). No user input reaches the
 * upstream request, so the SSRF guard is not needed here.
 */
export const dynamic = "force-dynamic";

const PRIMARY = "https://open.er-api.com/v6/latest/USD";
const FALLBACK = "https://api.frankfurter.dev/v1/latest?base=USD";

interface Cached { at: number; body: { base: string; rates: Record<string, number>; updated: string; nextUpdate?: string; provider: string } }
let cache: Cached | null = null;

async function fetchPrimary() {
  const res = await fetch(PRIMARY, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`primary ${res.status}`);
  const d = await res.json();
  if (d.result !== "success" || !d.rates) throw new Error("primary payload");
  return { base: "USD", rates: d.rates as Record<string, number>, updated: String(d.time_last_update_utc ?? ""), nextUpdate: String(d.time_next_update_utc ?? ""), provider: "ExchangeRate-API (open access)" };
}

async function fetchFallback() {
  const res = await fetch(FALLBACK, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`fallback ${res.status}`);
  const d = await res.json();
  if (!d.rates) throw new Error("fallback payload");
  return { base: "USD", rates: { USD: 1, ...(d.rates as Record<string, number>) }, updated: String(d.date ?? ""), provider: "Frankfurter (ECB reference rates)" };
}

export async function GET() {
  if (cache && Date.now() - cache.at < 60 * 60_000) return NextResponse.json({ ...cache.body, cached: true });
  try {
    const body = await fetchPrimary().catch(fetchFallback);
    cache = { at: Date.now(), body };
    return NextResponse.json({ ...body, cached: false });
  } catch (e) {
    if (cache) return NextResponse.json({ ...cache.body, cached: true, stale: true });
    return NextResponse.json({ error: "Exchange rates are unavailable right now", hint: `The server could not reach the rate feed. ${e instanceof Error ? e.message : ""}`.trim() }, { status: 502 });
  }
}
