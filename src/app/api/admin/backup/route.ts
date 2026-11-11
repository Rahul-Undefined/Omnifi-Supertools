import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { handleError } from "@/lib/server/api";
import { backupStatus, backupNow, excelNow } from "@/lib/server/github-backup";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Admin: backup status, or push a snapshot / Excel export to the GitHub data repository on demand. */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(backupStatus());
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { what?: string };
    const s = backupStatus();
    if (!s.configured) return NextResponse.json({ error: "GitHub backup is not configured (GITHUB_DATA_REPO + GITHUB_DATA_TOKEN)." }, { status: 400 });
    const ok = body.what === "excel" ? await excelNow(true) : await backupNow(`manual by ${user.id}`);
    await store().recordAudit({ at: Date.now(), actor: user.id, action: body.what === "excel" ? "backup.excel" : "backup.snapshot", detail: ok ? "pushed" : (backupStatus().lastError ?? "nothing to push") });
    if (!ok) return NextResponse.json({ ok: false, error: backupStatus().lastError ?? "Nothing to push" }, { status: backupStatus().lastError ? 502 : 200 });
    return NextResponse.json({ ok: true, ...backupStatus() });
  } catch (e) { return handleError(e); }
}
