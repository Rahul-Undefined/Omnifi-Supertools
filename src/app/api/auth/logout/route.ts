import { NextResponse } from "next/server";
import { currentUser, destroySession, isSameOrigin } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { handleError, jsonError } from "@/lib/server/api";

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const user = await currentUser();
    await destroySession();
    if (user) await store().recordAudit({ at: Date.now(), actor: user.id, action: "auth.logout" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
