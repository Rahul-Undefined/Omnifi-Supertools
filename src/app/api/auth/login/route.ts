import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateLocal, createSession, isSameOrigin, localAuthConfigured } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({ username: z.string().min(1).max(120), password: z.string().min(1).max(512), remember: z.boolean().optional().default(false) });

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    if (env.authMode === "header") return jsonError("Sign-in is handled by your identity provider", 400);
    const hasAccounts = localAuthConfigured() || (await store().listAccounts()).length > 0;
    if (!hasAccounts) return jsonError("No accounts are configured", 503, "Set ADMIN_PASSWORD on the server, or use Microsoft sign-in.");
    const rl = rateLimit(`auth:${clientKey(req)}`, env.rateAuth);
    if (!rl.ok) return NextResponse.json({ error: "Too many sign-in attempts", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429 });
    const parsed = schema.safeParse(await readJson(req, 4096));
    if (!parsed.success) return jsonError("Enter a username and password");
    const user = await authenticateLocal(parsed.data.username, parsed.data.password);
    await store().recordAudit({ at: Date.now(), actor: parsed.data.username.toLowerCase(), action: user ? "auth.login" : "auth.login_failed", detail: user ? "local" : undefined, ip: clientKey(req) });
    if (!user) return jsonError("Wrong username or password", 401);
    await createSession(user, parsed.data.remember);
    return NextResponse.json({ user });
  } catch (e) {
    return handleError(e);
  }
}
