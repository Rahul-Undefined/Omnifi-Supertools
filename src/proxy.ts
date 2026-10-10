import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge proxy: security headers on every response, and the sign-in gate.
 * Sign-in is required for the whole site whenever any sign-in method is
 * configured (ADMIN_PASSWORD, USERS_JSON, Microsoft, or header SSO).
 */
const CSP = [
  "default-src 'self'",
  // Next.js needs inline for its runtime; unsafe-eval is required by WebAssembly engines (FFmpeg, Tesseract) in some browsers.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  // All engines (FFmpeg, OCR) are self-hosted, so no third-party hosts are needed.
  "connect-src 'self' blob: data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "object-src 'none'",
].join("; ");

const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/health", "/branding/", "/ffmpeg/", "/tesseract/", "/tessdata/", "/favicon"];

function authRequired(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.USERS_JSON || (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET)) || process.env.AUTH_MODE === "header";
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  if (process.env.AUTH_MODE === "header" && req.headers.get(process.env.AUTH_HEADER_EMAIL || "x-forwarded-email")) return true;
  const token = req.cookies.get("omnifi_st_session")?.value;
  if (!token) return false;
  const secret = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? process.env.SESSION_SECRET : "dev-only-secret-change-me-dev-only-secret-change-me";
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  if (!isPublic && authRequired() && !(await hasValidSession(req))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
