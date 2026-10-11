import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/server/store";
import { currentUser, isSameOrigin } from "@/lib/server/auth";
import { rateLimit, clientKey } from "@/lib/server/ratelimit";
import { handleError, jsonError, readJson } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  favorites: z.array(z.string().max(80)).max(300),
  recent: z.array(z.object({ id: z.string().max(80), at: z.number().int().nonnegative() })).max(50),
  updatedAt: z.number().int().nonnegative().optional(),
});

/** Favorites and recent tools for the signed-in person. Anonymous visitors get 204: the browser keeps its own copy. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return new NextResponse(null, { status: 204 });
    const prefs = await store().getPrefs(user.id);
    return NextResponse.json({ prefs, persistent: store().kind === "postgres" });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    if (!user) return new NextResponse(null, { status: 204 });
    if (!rateLimit(`prefs:${clientKey(req, user.id)}`, 60).ok) return jsonError("Too many updates", 429);
    const parsed = schema.safeParse(await readJson(req, 64 * 1024));
    if (!parsed.success) return jsonError("Invalid preferences", 400);
    const prefs = { favorites: [...new Set(parsed.data.favorites)], recent: parsed.data.recent.slice(0, 30), updatedAt: Date.now() };
    await store().savePrefs(user.id, prefs);
    return NextResponse.json({ ok: true, updatedAt: prefs.updatedAt });
  } catch (e) {
    return handleError(e);
  }
}
