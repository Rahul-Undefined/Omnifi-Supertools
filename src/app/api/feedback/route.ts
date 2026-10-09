import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/server/store";
import { currentUser, isSameOrigin, requireAdmin } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

const schema = z.object({
  name: z.string().max(80).optional().default(""),
  kind: z.enum(["idea", "bug", "praise", "question"]),
  tool: z.string().max(80).optional().default(""),
  message: z.string().min(3).max(4000),
});

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    if (!rateLimit(`fb:${clientKey(req, user?.id)}`, 10).ok) return jsonError("Too many submissions. Try again in a minute.", 429);
    const parsed = schema.safeParse(await readJson(req, 16 * 1024));
    if (!parsed.success) return jsonError("Write at least a few words", 400);
    const { name, kind, tool, message } = parsed.data;
    await store().recordAudit({ at: Date.now(), actor: user?.id ?? (name.trim() || "anonymous"), action: `feedback.${kind}`, detail: `${tool ? `[${tool}] ` : ""}${message.trim()}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function GET() {
  try {
    await requireAdmin();
    const snap = await store().snapshot();
    const items = snap.audit.filter((a) => a.action.startsWith("feedback.")).sort((a, b) => b.at - a.at).slice(0, 200);
    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}
