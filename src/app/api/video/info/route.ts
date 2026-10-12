import { NextResponse } from "next/server";
import { z } from "zod";
import { videoInfo } from "@/lib/server/video";
import { currentUser, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({ url: z.string().min(4).max(2048) });

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    const rl = rateLimit(`video:${clientKey(req, user?.id)}`, 20);
    if (!rl.ok) return jsonError("Too many requests. Slow down.", 429, `Try again in ${rl.retryAfter}s.`);
    const parsed = schema.safeParse(await readJson(req, 16 * 1024));
    if (!parsed.success) return jsonError("Paste a video link", 400);
    const info = await videoInfo(parsed.data.url);
    await store().recordAudit({ at: Date.now(), actor: user?.id ?? "anonymous", action: "video.info", detail: new URL(info.url).hostname });
    return NextResponse.json(info);
  } catch (e) {
    return handleError(e);
  }
}
