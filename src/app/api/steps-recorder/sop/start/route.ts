import { NextResponse } from "next/server";
import { AiError } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { rateLimit, dailyQuota, consumeAllowance, refundAllowance } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";
import { stepsRecorderAuth, deviceAllowanceKey } from "../../_shared";
import { generateSop, sopRequestSchema } from "../../_generate";
import { createJob, completeJob, failJob, runningJobs } from "../../_jobs";

/**
 * Starts an asynchronous SOP job and answers immediately with a job id (HTTP 202). The desktop app then
 * polls GET /api/steps-recorder/sop/result?job=<id>. Allowance and pacing are checked here, up front;
 * the allowance is refunded if the provider fails.
 */
export async function POST(req: Request) {
  try {
    const auth = stepsRecorderAuth(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    const deviceId = auth.deviceId;

    const rl = await rateLimit(`sr:${deviceId}`, 3);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests from this computer", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
    if (runningJobs(deviceId) > 0) return jsonError("An AI SOP is already being written for this computer", 409, "Wait for it to finish, then try again.");

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

    const job = createJob(deviceId);
    const request = parsed.data;
    // Fire and forget: the job keeps running after this response is sent.
    void (async () => {
      try {
        const out = await generateSop(request, deviceId);
        completeJob(job.id, out.sop, out.imagesUsed, out.model);
      } catch (e) {
        await refund();
        if (e instanceof AiError) failJob(job.id, e.message, e.status, e.hint);
        else { console.error(e); failJob(job.id, "The SOP could not be generated. Try again.", 500); }
      }
    })();

    return NextResponse.json({ jobId: job.id, allowance: mine, pollAfterMs: 5000 }, { status: 202 });
  } catch (e) {
    return handleError(e);
  }
}
