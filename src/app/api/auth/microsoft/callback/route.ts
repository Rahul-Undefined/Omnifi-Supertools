import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "@/lib/server/env";
import { appUrl, createSession, roleForEmail } from "@/lib/server/auth";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const jwks = () => createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${env.azureTenantId}/discovery/v2.0/keys`));

/** Step 2: exchange the code, verify the ID token, create the session. */
export async function GET(req: Request) {
  const base = appUrl(req);
  const fail = (code: string) => NextResponse.redirect(`${base}/login?error=${code}`);
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get("omnifi_st_oauth")?.value;
  jar.delete("omnifi_st_oauth");
  if (!raw) return fail("session-expired");
  let saved: { state: string; nonce: string; next: string; remember: boolean };
  try {
    saved = JSON.parse(raw);
  } catch {
    return fail("session-expired");
  }
  if (url.searchParams.get("error")) return fail("microsoft-denied");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== saved.state) return fail("state-mismatch");

  const tokenRes = await fetch(`https://login.microsoftonline.com/${env.azureTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.azureClientId, client_secret: env.azureClientSecret, grant_type: "authorization_code", code, redirect_uri: `${base}/api/auth/microsoft/callback`, scope: "openid profile email" }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) {
    console.error("Microsoft token exchange failed", tokens.error_description ?? tokens.error);
    return fail("token-exchange");
  }

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(tokens.id_token, jwks(), { audience: env.azureClientId });
    claims = verified.payload as Record<string, unknown>;
  } catch (e) {
    console.error("ID token verification failed", e);
    return fail("token-invalid");
  }
  if (claims.nonce !== saved.nonce) return fail("state-mismatch");
  const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
  if (!email || !email.includes("@")) return fail("no-email");
  const domain = email.split("@")[1];
  if (env.allowedDomains.length && !env.allowedDomains.includes(domain)) return fail("domain-not-allowed");

  const name = String(claims.name ?? "").trim() || email;
  const role = await roleForEmail(email);
  await createSession({ id: email, name, email, role, via: "microsoft" }, saved.remember);
  await store().recordAudit({ at: Date.now(), actor: email, action: "auth.login", detail: "microsoft" });
  return NextResponse.redirect(`${base}${saved.next.startsWith("/") ? saved.next : "/"}`);
}
