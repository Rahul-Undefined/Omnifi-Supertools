import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { createHash, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { env, requireSessionSecret } from "./env";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

const COOKIE = "omnifi_st_session";
const CSRF_COOKIE = "omnifi_st_csrf";

function key() {
  return new TextEncoder().encode(requireSessionSecret());
}

export async function createSession(user: User): Promise<void> {
  const jwt = await new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.sessionHours}h`)
    .sign(key());
  const jar = await cookies();
  jar.set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/", maxAge: env.sessionHours * 3600 });
  jar.set(CSRF_COOKIE, randomBytes(16).toString("hex"), { httpOnly: false, sameSite: "lax", secure: env.isProd, path: "/", maxAge: env.sessionHours * 3600 });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** Resolve the current user: header-based SSO first (if enabled), then the signed cookie. */
export async function currentUser(): Promise<User | null> {
  if (env.authMode === "header") {
    const h = await headers();
    const email = h.get(env.headerEmail)?.toLowerCase();
    const name = h.get(env.headerUser) ?? email;
    if (email) return { id: email, name: name ?? email, email, role: env.headerAdmins.includes(email) ? "admin" : "user" };
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const u = payload.user as User | undefined;
    return u && u.email ? u : null;
  } catch {
    return null;
  }
}

/**
 * "Open" mode: no accounts configured and no SSO. The platform is an internal
 * tool behind the office network, so admin pages are readable by everyone
 * until an administrator sets ADMIN_PASSWORD / USERS_JSON or AUTH_MODE=header.
 */
export function adminOpen(): boolean {
  return env.authMode !== "header" && !localAuthConfigured();
}

export async function requireAdmin(): Promise<User> {
  const u = await currentUser();
  if (u?.role === "admin") return u;
  if (adminOpen()) return { id: "anonymous", name: "Anyone (open mode)", email: "", role: "admin" };
  throw new AuthError(u ? 403 : 401);
}

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(status === 401 ? "Sign in required" : "Admin access required");
  }
}

/* ---------- Local credential store ---------- */

interface LocalUser { username: string; name: string; email: string; role: "admin" | "user"; password?: string; passwordHash?: string }

function localUsers(): LocalUser[] {
  const list: LocalUser[] = [];
  if (env.adminPassword) list.push({ username: env.adminUser, name: "Administrator", email: `${env.adminUser}@omnifi.local`, role: "admin", password: env.adminPassword });
  if (env.usersJson) {
    try {
      const parsed = JSON.parse(env.usersJson) as LocalUser[];
      list.push(...parsed.filter((u) => u.username && (u.password || u.passwordHash)));
    } catch {
      console.error("USERS_JSON is not valid JSON; ignoring");
    }
  }
  return list;
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, u: LocalUser): boolean {
  if (u.passwordHash?.startsWith("scrypt$")) {
    const [, salt, hash] = u.passwordHash.split("$");
    const test = scryptSync(password, salt, 64);
    return test.length === hash.length / 2 && timingSafeEqual(test, Buffer.from(hash, "hex"));
  }
  if (u.password) {
    const a = createHash("sha256").update(password).digest();
    const b = createHash("sha256").update(u.password).digest();
    return timingSafeEqual(a, b);
  }
  return false;
}

export function authenticateLocal(username: string, password: string): User | null {
  const u = localUsers().find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!u) {
    // Burn similar time to a real check to blunt user enumeration.
    scryptSync(password, "x", 64);
    return null;
  }
  if (!verifyPassword(password, u)) return null;
  return { id: u.username, name: u.name, email: u.email, role: u.role };
}

export function localAuthConfigured(): boolean {
  return localUsers().length > 0;
}

/** Double-submit CSRF: mutating requests must echo the csrf cookie in a header. */
export async function checkCsrf(req: Request): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get(CSRF_COOKIE)?.value;
  const header = req.headers.get("x-csrf-token");
  // Same-origin JSON fetches without a session cookie are safe (nothing to forge).
  if (!cookie) return isSameOrigin(req);
  return Boolean(header) && header === cookie && isSameOrigin(req);
}

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) return true; // non-browser or same-origin GET-like fetch
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export { COOKIE as SESSION_COOKIE, CSRF_COOKIE };
