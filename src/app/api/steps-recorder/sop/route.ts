import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { rateLimit, dailyQuota, consumeAllowance, refundAllowance } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";
import { stepsRecorderAuth, deviceAllowanceKey } from "../_shared";
import { generateSop, sopRequestSchema } from "../_generate";

/**
 * Steps Recorder desktop app -> AI-written SOP (synchronous variant, kept for older app builds).
 * New builds use POST sop/start + GET sop/result so a slow model never hits an HTTP timeout.
 *
 * The desktop app never holds an AI key. It sends the recorded steps plus downscaled screenshots with the
 * app token (STEPS_RECORDER_TOKEN) and a per-install device id; this server holds the provider key, enforces
 * the per-device allowance (default 5 SOPs per 5 hours) and the team-wide pacing, and returns the SOP as JSON.
 * Screenshots are processed in memory only and never stored.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const auth = stepsRecorderAuth(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    const deviceId = auth.deviceId;

    const rl = await rateLimit(`sr:${deviceId}`, 3);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests from this computer", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });

    const parsed = sopRequestSchema.safeParse(await readJson(req, 40 * 1024 * 1024));
    if (!parsed.success) return jsonError("Invalid request", 400, parsed.error.issues[0]?.message);

    const mine = await consumeAllowance(deviceAllowanceKey(deviceId), env.stepsRecorderQuota, env.stepsRecorderWindowHours);
    if (!mine.ok) {
      const mins = Math.max(1, Math.ceil((mine.resetsAt - Date.now()) / 60_000));
      return NextResponse.json({ error: "AI SOP allowance used up for now", hint: `${mine.limit} AI SOPs per ${mine.windowHours} hours per computer. Resets in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}.`, allowance: mine }, { status: 429, headers: { "retry-after": String(Math.ceil((mine.resetsAt - Date.now()) / 1000)) } });
    }
    const refund = () => refundAllowance(deviceAllowanceKey(deviceId), env.stepsRecorderWindowHours);

    if (env.aiGlobalPerMin > 0 && !(await rateLimit("ai:global", env.aiGlobalPerMin)).ok) { await refund(); return NextResponse.json({ error: "The AI service is busy right now", hint: "Try again in a few seconds." }, { status: 429, headers: { "retry-after": "15" } }); }
    if (env.aiGlobalPerDay > 0) { const g = await dailyQuota("ai:global", env.aiGlobalPerDay); if (!g.ok) { await refund(); return NextResponse.json({ error: "Today's shared AI allowance is used up", hint: "Resets at midnight UTC." }, { status: 429, headers: { "retry-after": String(g.retryAfter) } }); } }

    try {
      const out = await generateSop(parsed.data, deviceId);
      return NextResponse.json({ sop: out.sop, allowance: mine, imagesUsed: out.imagesUsed });
    } catch (e) {
      await refund(); // provider failure is not the user's fault
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}
