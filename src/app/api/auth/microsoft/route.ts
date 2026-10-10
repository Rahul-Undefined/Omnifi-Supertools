import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/server/env";
import { appUrl, microsoftConfigured } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Step 1: send the person to Microsoft. State + nonce are kept in a short-lived cookie. */
export async function GET(req: Request) {
  if (!microsoftConfigured()) return NextResponse.redirect(`${appUrl(req)}/login?error=microsoft-not-configured`);
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";
  const remember = url.searchParams.get("remember") === "1";
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("omnifi_st_oauth", JSON.stringify({ state, nonce, next: next.startsWith("/") ? next : "/", remember }), { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: env.azureClientId,
    response_type: "code",
    redirect_uri: `${appUrl(req)}/api/auth/microsoft/callback`,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://login.microsoftonline.com/${env.azureTenantId}/oauth2/v2.0/authorize?${params}`);
}
