import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/server/store";
import { currentUser } from "@/lib/server/auth";
import { getTool } from "@/tools/registry";
import { handleError, readJson } from "@/lib/server/api";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";

/**
 * Usage telemetry: tool id, outcome, duration, file count. Deliberately no
 * file names, sizes or contents. Anything not matching the schema is dropped.
 */
const schema = z.object({
  tool: z.string().max(80),
  ok: z.boolean(),
  ms: z.number().int().min(0).max(24 * 3600 * 1000),
  files: z.number().int().min(0).max(10_000),
  cancelled: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!rateLimit(clientKey(req, user?.id), 240).ok) return NextResponse.json({ ok: false }, { status: 429 });
    const parsed = schema.safeParse(await readJson(req, 4096));
    if (!parsed.success || !getTool(parsed.data.tool)) return NextResponse.json({ ok: false }, { status: 400 });
    await store().recordUsage({ at: Date.now(), ...parsed.data, cancelled: parsed.data.cancelled ?? false, user: user?.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
