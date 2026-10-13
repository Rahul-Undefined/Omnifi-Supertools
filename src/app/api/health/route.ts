import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness check for Render. Deliberately minimal: no versions, counts, storage or provider details. */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
