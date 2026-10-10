import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { createHash, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { env, requireSessionSecret } from "./env";
import { store, type Account } from "./store";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  /** How the person signed in. */
  via?: "microsoft" | "local" | "header";
}

export const SESSION_COOKIE = "omnifi_st_session";
export const CSRF_COOKIE = "omnifi_st_csrf";

function key() {
  return new TextEncoder().encode(requireSessionSecret());
}

export function firstName(u: Pick<User, "name" | "email">): string {
  const n = (u.name || "").trim();
  if (n && !n.includes("@")) return n.split(/\s+/)[0];
  const local = (u.email || "").split("@")[0];
  return local ? local.split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase()) : "there";
}

/** Create the signed session cookie. `remember` keeps people signed in for SESSION_REMEMBER_DAYS. */
export async function createSession(user: User, remember = false): Promise<void> {
  const maxAge = remember ? env.rememberDays * 86400 : env.sessionHours * 3600;
  const jwt = await new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(key());
  const jar = await cookies();
  const base = { sameSite: "lax" as const, secure: env.isProd, path: "/" };
  // Session cookie (no maxAge) when not remembered: cleared when the browser closes.
  jar.set(SESSION_COOKIE, jwt, { ...base, httpOnly: true, ...(remember ? { maxAge } : {}) });
  jar.set(CSRF_COOKIE, randomBytes(16).toString("hex"), { ...base, httpOnly: false, ...(remember ? { maxAge } : {}) });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** Resolve the current user: header-based SSO first (if enabled), then the signed cookie. */
export async function currentUser(): Promise<User | null> {
  if (env.authMode === "header") {
    const h = await headers();
    const email = h.get(env.headerEmail)?.toLowerCase();
    const name = h.get(env.headerUser) ?? email;
    if (email) return { id: email, name: name ?? email, email, role: env.headerAdmins.includes(email) ? "admin" : "user", via: "header" };
  }
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const u = payload.user as User | undefined;
    return u && u.email ? u : null;
  } catch {
    return null;
  }
}

/* ---------- What sign-in methods exist ---------- */

export function microsoftConfigured(): boolean {
  return Boolean(env.azureClientId && env.azureClientSecret);
}

export function localAuthConfigured(): boolean {
  return Boolean(env.adminPassword) || envUsers().length > 0;
}

/** Sign-in is required for the whole site as soon as any sign-in method exists. */
export function authRequired(): boolean {
  return env.authMode === "header" || microsoftConfigured() || localAuthConfigured();
}

/** "Open" mode: nothing configured at all (fresh local dev). Admin pages are readable by everyone. */
export function adminOpen(): boolean {
  return !authRequired();
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (u) return u;
  if (!authRequired()) return { id: "anonymous", name: "Guest", email: "", role: "admin", via: "local" };
  throw new AuthError(401);
}

export async function requireAdmin(): Promise<User> {
  const u = await currentUser();
  if (u?.role === "admin") return u;
  if (adminOpen()) return { id: "anonymous", name: "Anyone (open mode)", email: "", role: "admin", via: "local" };
  throw new AuthError(u ? 403 : 401);
}

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(status === 401 ? "Sign in required" : "Admin access required");
  }
}

/* ---------- Local credential accounts ---------- */

interface EnvUser { username: string; name: string; email: string; role: "admin" | "user"; password?: string; passwordHash?: string }

function envUsers(): EnvUser[] {
  const list: EnvUser[] = [];
  if (env.adminPassword) list.push({ username: env.adminUser, name: "Administrator", email: `${env.adminUser}@omnifi.local`, role: "admin", password: env.adminPassword });
  if (env.usersJson) {
    try {
      list.push(...(JSON.parse(env.usersJson) as EnvUser[]).filter((u) => u.username && (u.password || u.passwordHash)));
    } catch {
      console.error("USERS_JSON is not valid JSON; ignoring");
    }
  }
  return list;
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, u: { password?: string; passwordHash?: string }): boolean {
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

/** Check env accounts, then accounts created by an admin in the app. */
export async function authenticateLocal(username: string, password: string): Promise<User | null> {
  const login = username.trim().toLowerCase();
  const fromEnv = envUsers().find((x) => x.username.toLowerCase() === login || x.email?.toLowerCase() === login);
  if (fromEnv) return verifyPassword(password, fromEnv) ? { id: fromEnv.username.toLowerCase(), name: fromEnv.name, email: fromEnv.email, role: fromEnv.role, via: "local" } : null;
  const acct = (await store().getAccount(login)) ?? (await store().listAccounts()).find((a) => a.email.toLowerCase() === login) ?? null;
  if (!acct) {
    scryptSync(password, "x", 64); // burn similar time to a real check
    return null;
  }
  return verifyPassword(password, acct) ? { id: acct.username, name: acct.name, email: acct.email, role: acct.role, via: "local" } : null;
}

export async function createAccount(input: { username: string; name: string; email: string; role: "admin" | "user"; password: string }): Promise<Account> {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._@-]{2,80}$/.test(username)) throw new Error("Username may contain letters, numbers, dots, dashes and @");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters");
  if (envUsers().some((u) => u.username.toLowerCase() === username)) throw new Error("That username is reserved");
  const a: Account = { username, name: input.name.trim() || username, email: input.email.trim().toLowerCase(), role: input.role, passwordHash: hashPassword(input.password), createdAt: Date.now() };
  await store().saveAccount(a);
  return a;
}

/** Role for a Microsoft sign-in: admin list from env, or an existing account's role. */
export async function roleForEmail(email: string): Promise<"admin" | "user"> {
  const e = email.toLowerCase();
  if (env.adminEmails.includes(e)) return "admin";
  const acct = (await store().listAccounts()).find((a) => a.email.toLowerCase() === e);
  return acct?.role ?? "user";
}

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Public base URL for OAuth redirects. */
export function appUrl(req: Request): string {
  if (env.appUrl) return env.appUrl.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") ? "http" : proto}://${host}`;
}
