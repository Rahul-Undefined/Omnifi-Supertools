import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/server/env";

/**
 * Authentication for the Steps Recorder desktop app: a shared app token (STEPS_RECORDER_TOKEN, 32+ chars,
 * baked into the app build; rotate it by changing the env var and shipping a new build) plus a per-install
 * device id used for the allowance. No user session exists for the desktop app, so these endpoints are
 * listed as public in src/proxy.ts and do their own check here.
 */
export function stepsRecorderAuth(req: Request): { ok: true; deviceId: string } | { ok: false; status: number; error: string } {
  const expected = env.stepsRecorderToken;
  if (!expected || expected.length < 32) return { ok: false, status: 503, error: "The AI SOP service is not configured on this server (STEPS_RECORDER_TOKEN)." };
  const given = req.headers.get("x-steps-recorder-token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: "This version of Steps Recorder is not authorised for the AI SOP service. Ask the administrator for the current build." };
  const deviceId = (req.headers.get("x-steps-recorder-device") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{16,64}$/.test(deviceId)) return { ok: false, status: 400, error: "Missing device id." };
  return { ok: true, deviceId };
}

export function deviceAllowanceKey(deviceId: string): string {
  return `sr:${deviceId}`;
}
