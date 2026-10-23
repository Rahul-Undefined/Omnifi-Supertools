import { NextResponse } from "next/server";
import { handleError, jsonError } from "@/lib/server/api";
import { stepsRecorderAuth } from "../../_shared";
import { getJob } from "../../_jobs";

export const dynamic = "force-dynamic";

/** Polled by the desktop app after POST sop/start: {state: running} | {state: done, sop, imagesUsed} | {state: failed, error, hint}. */
export async function GET(req: Request) {
  try {
    const auth = stepsRecorderAuth(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    const id = new URL(req.url).searchParams.get("job") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonError("Missing job id", 400);
    const job = getJob(id, auth.deviceId);
    if (!job) return jsonError("Unknown or expired job", 404, "The SOP job was not found (jobs expire after 30 minutes or when the server restarts). Press Generate AI SOP to try again.");
    const headers = { "cache-control": "no-store" };
    if (job.state === "running") return NextResponse.json({ state: "running", elapsedMs: Date.now() - job.startedAt }, { headers });
    if (job.state === "done") return NextResponse.json({ state: "done", sop: job.sop, imagesUsed: job.imagesUsed, elapsedMs: job.finishedAt - job.startedAt }, { headers });
    return NextResponse.json({ state: "failed", error: job.error, hint: job.hint }, { headers });
  } catch (e) {
    return handleError(e);
  }
}
