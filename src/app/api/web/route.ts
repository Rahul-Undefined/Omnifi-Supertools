import { NextResponse } from "next/server";
import { z } from "zod";
import { actions } from "@/lib/server/web-tools";
import { env } from "@/lib/server/env";
import { currentUser, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({
  action: z.string().refine((a) => a in actions, "Unknown action"),
  target: z.string().min(1).max(2048),
  options: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    const rl = rateLimit(clientKey(req, user?.id), env.rateWeb);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests. Slow down.", hint: `Try again in ${rl.retryAfter}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
    const parsed = schema.safeParse(await readJson(req, 512 * 1024));
    if (!parsed.success) return jsonError("Invalid request", 400, parsed.error.issues[0]?.message);
    const { action, target, options } = parsed.data;
    const result = await actions[action](target, options);
    await store().recordAudit({ at: Date.now(), actor: user?.id ?? "anonymous", action: `web.${action}`, detail: new URL(/^[a-z]+:\/\//i.test(target) ? target : `https://${target}`).hostname });
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
