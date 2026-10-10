import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, createAccount, isSameOrigin, microsoftConfigured } from "@/lib/server/auth";
import { store } from "@/lib/server/store";
import { env } from "@/lib/server/env";
import { handleError, jsonError, readJson } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const safe = (a: { username: string; name: string; email: string; role: string; createdAt: number }) => ({ username: a.username, name: a.name, email: a.email, role: a.role, createdAt: a.createdAt });

export async function GET() {
  try {
    await requireAdmin();
    const accounts = (await store().listAccounts()).map(safe);
    return NextResponse.json({ accounts, microsoft: microsoftConfigured(), allowedDomains: env.allowedDomains, adminEmails: env.adminEmails, persistent: Boolean(env.databaseUrl) });
  } catch (e) {
    return handleError(e);
  }
}

const createSchema = z.object({ username: z.string().min(2).max(80), name: z.string().max(120).optional().default(""), email: z.string().email().max(160), role: z.enum(["admin", "user"]).default("user"), password: z.string().min(8).max(512) });

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const admin = await requireAdmin();
    const parsed = createSchema.safeParse(await readJson(req, 8192));
    if (!parsed.success) return jsonError("Check the form", 400, parsed.error.issues[0]?.message);
    let account;
    try {
      account = await createAccount(parsed.data);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Could not create the account", 400);
    }
    await store().recordAudit({ at: Date.now(), actor: admin.id, action: "admin.user_created", detail: `${account.username} (${account.role})` });
    return NextResponse.json({ account: safe(account) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    if (!isSameOrigin(req)) return jsonError("Cross-origin requests are not allowed", 403);
    const admin = await requireAdmin();
    const { username } = z.object({ username: z.string().min(1) }).parse(await readJson(req, 1024));
    await store().deleteAccount(username);
    await store().recordAudit({ at: Date.now(), actor: admin.id, action: "admin.user_deleted", detail: username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
