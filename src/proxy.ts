import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge proxy: security headers on every response, and the sign-in gate.
 *
 * - Production always requires sign-in. If no sign-in method is configured
 *   (no ADMIN_PASSWORD / USERS_JSON / Microsoft / trusted-proxy SSO) the
 *   whole app fails closed with 503 instead of running open.
 * - Header SSO (AUTH_MODE=header) is only honoured when the request also
 *   carries the shared proxy secret, so forged identity headers never count.
 * - In development with nothing configured the site stays open.
 */
const CSP = [
  "default-src 'self'",
  // Next.js needs inline scripts for hydration; WebAssembly engines (FFmpeg, Tesseract, pdf.js) need wasm-unsafe-eval, not unsafe-eval.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data:",
  // Only the sandboxed HTML preview frame (srcdoc) may be embedded.
  "frame-src 'self' about:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/health", "/branding/", "/ffmpeg/", "/tesseract/", "/tessdata/", "/favicon"];

const isProd = process.env.NODE_ENV === "production";
const headerMode = process.env.AUTH_MODE === "header";
const proxySecret = process.env.AUTH_PROXY_SECRET ?? "";

function localConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.USERS_JSON);
}
function microsoftConfigured(): boolean {
  return Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
}
function headerConfigured(): boolean {
  return headerMode && proxySecret.length >= 32;
}
export function authRequired(): boolean {
  return isProd || headerMode || localConfigured() || microsoftConfigured();
}
/** Sign-in is required but nothing usable is configured: fail closed. */
export function authMisconfigured(): boolean {
  if (headerMode && !headerConfigured()) return true;
  return isProd && !(localConfigured() || microsoftConfigured() || headerConfigured());
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  if (headerConfigured()) {
    const secret = req.headers.get("x-omnifi-proxy-secret") ?? "";
    const email = req.headers.get(process.env.AUTH_HEADER_EMAIL || "x-forwarded-email") ?? "";
    if (secret && constantTimeEqual(secret, proxySecret) && email.includes("@")) return true;
  }
  const token = req.cookies.get("omnifi_st_session")?.value;
  if (!token) return false;
  const secret = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : isProd ? "" : "dev-only-secret-change-me-dev-only-secret-change-me";
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Cache-Control", res.headers.get("Cache-Control") ?? "no-store");
  if (isProd) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  const isHealth = pathname === "/api/health";

  if (authMisconfigured() && !isHealth && !pathname.startsWith("/branding/") && !pathname.startsWith("/favicon")) {
    const msg = "Sign-in is not configured on this server. Set ADMIN_PASSWORD, USERS_JSON, Microsoft sign-in, or AUTH_PROXY_SECRET for header SSO.";
    if (pathname.startsWith("/api/")) return withSecurityHeaders(NextResponse.json({ error: msg }, { status: 503 }));
    return withSecurityHeaders(new NextResponse(`<!doctype html><meta charset="utf-8"><title>Omnifi SuperTools</title><body style="font-family:system-ui;padding:40px;color:#0A0F3D"><h1>Not available yet</h1><p>${msg}</p>`, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }));
  }

  if (!isPublic && authRequired() && !(await hasValidSession(req))) {
    if (pathname.startsWith("/api/")) return withSecurityHeaders(NextResponse.json({ error: "Sign in required" }, { status: 401 }));
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
    return withSecurityHeaders(NextResponse.redirect(url));
  }
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
