import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy: security headers on every response and a gate on /admin.
 * Session verification itself happens in server components / routes with
 * the full Node runtime; here we only redirect when no session cookie exists.
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
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://unpkg.com https://tessdata.projectnaptha.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const accountsConfigured = Boolean(process.env.ADMIN_PASSWORD || process.env.USERS_JSON) || process.env.AUTH_MODE === "header";
  if (accountsConfigured && pathname.startsWith("/admin") && !req.cookies.get("omnifi_st_session") && !req.headers.get("x-forwarded-email")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|branding/).*)"],
};
