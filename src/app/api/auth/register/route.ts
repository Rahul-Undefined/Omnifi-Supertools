import { NextResponse } from "next/server";
import { z } from "zod";
import { requestAccount, isSameOrigin, authMisconfigured } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({ name: z.string().min(1).max(120), email: z.string().email().max(160), password: z.string().min(8).max(512) });

/** Self-service account request: stored as pending until an administrator approves it on /admin. */
export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    if (env.authMode === "header") return jsonError("Accounts are managed by your identity provider", 400);
    if (authMisconfigured()) return jsonError("Sign-in is not configured on this server", 503);
    const rl = await rateLimit(`register:${clientKey(req)}`, Math.max(1, Math.floor(env.rateAuth / 2)));
    if (!rl.ok) return NextResponse.json({ error: "Too many requests", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429 });
    const parsed = schema.safeParse(await readJson(req, 4096));
    if (!parsed.success) return jsonError("Check the form", 400, parsed.error.issues[0]?.message);
    let account;
    try { account = await requestAccount(parsed.data); }
    catch (e) { return jsonError(e instanceof Error ? e.message : "Could not send the request", 400); }
    await store().recordAudit({ at: Date.now(), actor: account.username, action: "auth.account_requested", detail: account.name, ip: clientKey(req) });
    return NextResponse.json({ ok: true, email: account.email });
  } catch (e) {
    return handleError(e);
  }
}
