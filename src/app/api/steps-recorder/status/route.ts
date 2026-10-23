import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { peekAllowance } from "@/lib/server/ratelimit";
import { handleError, jsonError } from "@/lib/server/api";
import { stepsRecorderAuth, deviceAllowanceKey } from "../_shared";

export const dynamic = "force-dynamic";

/** Lets the Steps Recorder app show "x of 5 AI SOPs used, resets in n min" without spending a request. */
export async function GET(req: Request) {
  try {
    const auth = stepsRecorderAuth(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    const allowance = await peekAllowance(deviceAllowanceKey(auth.deviceId), env.stepsRecorderQuota, env.stepsRecorderWindowHours);
    return NextResponse.json({ configured: aiStatus().configured, allowance }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
