import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

/**
 * Usage, audit, feedback, accounts, preferences and rate-limit counters.
 * PostgreSQL when DATABASE_URL is set, otherwise a JSON file under DATA_DIR
 * so the app works with zero infrastructure.
 *
 * Data minimisation: usage holds tool ids, timings and outcomes only. Audit
 * holds actor, action and a short technical detail (never document contents,
 * prompts, passwords or tokens). Feedback text lives in its own collection
 * with its own retention. Everything is purged after RETENTION_*_DAYS.
 */
export interface UsageEvent {
  at: number;
  tool: string;
  ok: boolean;
  ms: number;
  files: number;
  cancelled: boolean;
  user?: string;
}

export interface AuditEvent {
  at: number;
  actor: string;
  action: string;
  detail?: string;
  ip?: string;
}

export interface FeedbackItem {
  at: number;
  from: string;
  kind: string;
  tool: string;
  message: string;
}

export interface Account {
  username: string; // lower-case login name or email
  name: string;
  email: string;
  role: "admin" | "user";
  passwordHash: string; // scrypt$salt$hash
  createdAt: number;
}

/** Per-person preferences synced across browsers: favorites and recently used tools. */
export interface UserPrefs {
  favorites: string[];
  recent: { id: string; at: number }[];
  updatedAt: number;
}

interface Snapshot {
  usage: UsageEvent[];
  audit: AuditEvent[];
  users: Record<string, number>; // userId -> last seen
  accounts?: Account[];
  prefs?: Record<string, UserPrefs>;
  feedback?: FeedbackItem[];
  rates?: Record<string, { start: number; count: number }>;
  aiCache?: Record<string, { at: number; value: string }>;
  purgedAt?: number;
}

const MAX_USAGE = 20_000;
const MAX_AUDIT = 5_000;
const MAX_FEEDBACK = 2_000;
const PURGE_EVERY_MS = 60 * 60 * 1000;

export interface Retention { usageDays: number; auditDays: number; feedbackDays: number; prefsDays: number }

export function retentionFromEnv(): Retention {
  return { usageDays: env.retentionUsageDays, auditDays: env.retentionAuditDays, feedbackDays: env.retentionFeedbackDays, prefsDays: env.retentionPrefsDays };
}

interface Backend {
  recordUsage(e: UsageEvent): Promise<void>;
  recordAudit(e: AuditEvent): Promise<void>;
  recordFeedback(f: FeedbackItem): Promise<void>;
  listFeedback(limit?: number): Promise<FeedbackItem[]>;
  snapshot(): Promise<Snapshot>;
  listAccounts(): Promise<Account[]>;
  getAccount(username: string): Promise<Account | null>;
  saveAccount(a: Account): Promise<void>;
  deleteAccount(username: string): Promise<void>;
  getPrefs(userId: string): Promise<UserPrefs | null>;
  savePrefs(userId: string, prefs: UserPrefs): Promise<void>;
  /** Increment a fixed-window counter and return the new count. */
  rateHit(key: string, windowStart: number, windowMs: number): Promise<number>;
  cacheGet(key: string, maxAgeMs: number): Promise<string | null>;
  cacheSet(key: string, value: string): Promise<void>;
  /** Delete records older than the retention periods. Returns counts removed. */
  purge(r: Retention, now?: number): Promise<Record<string, number>>;
  kind: string;
}

/** Shared throttle so purge runs at most hourly per process. */
let lastPurge = 0;
async function maybePurge(b: Backend) {
  const now = Date.now();
  if (now - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now;
  try { await b.purge(retentionFromEnv(), now); } catch (e) { console.error("retention purge failed", e instanceof Error ? e.message : String(e)); }
}

/* ---------- JSON file backend (also the in-memory fallback for counters) ---------- */
class FileBackend implements Backend {
  kind = "file";
  private file = path.join(process.cwd(), env.dataDir, "store.json");
  private data: Snapshot | null = null;
  private writing: Promise<void> = Promise.resolve();

  private async load(): Promise<Snapshot> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      this.data = { usage: [], audit: [], users: {} };
    }
    return this.data!;
  }
  private flush() {
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const { rates, ...persisted } = this.data!; // counters are process-local
      void rates;
      await writeFile(this.file, JSON.stringify(persisted));
    }).catch((e) => console.error("store flush failed", e instanceof Error ? e.message : String(e)));
  }
  async recordUsage(e: UsageEvent) {
    const d = await this.load();
    d.usage.push(e);
    if (d.usage.length > MAX_USAGE) d.usage.splice(0, d.usage.length - MAX_USAGE);
    if (e.user) d.users[e.user] = e.at;
    this.flush();
    void maybePurge(this);
  }
  async recordAudit(e: AuditEvent) {
    const d = await this.load();
    d.audit.push(e);
    if (d.audit.length > MAX_AUDIT) d.audit.splice(0, d.audit.length - MAX_AUDIT);
    if (e.actor) d.users[e.actor] = e.at;
    this.flush();
    void maybePurge(this);
  }
  async recordFeedback(f: FeedbackItem) {
    const d = await this.load();
    d.feedback = [...(d.feedback ?? []), f].slice(-MAX_FEEDBACK);
    this.flush();
  }
  async listFeedback(limit = 200) {
    return [...((await this.load()).feedback ?? [])].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async snapshot() {
    const { rates, ...rest } = await this.load();
    void rates;
    return structuredClone(rest);
  }
  async listAccounts() {
    return [...((await this.load()).accounts ?? [])];
  }
  async getAccount(username: string) {
    return (await this.load()).accounts?.find((a) => a.username === username.toLowerCase()) ?? null;
  }
  async saveAccount(a: Account) {
    const d = await this.load();
    d.accounts = [...(d.accounts ?? []).filter((x) => x.username !== a.username), a];
    this.flush();
  }
  async deleteAccount(username: string) {
    const d = await this.load();
    d.accounts = (d.accounts ?? []).filter((x) => x.username !== username.toLowerCase());
    this.flush();
  }
  async getPrefs(userId: string) {
    return (await this.load()).prefs?.[userId] ?? null;
  }
  async savePrefs(userId: string, prefs: UserPrefs) {
    const d = await this.load();
    d.prefs = { ...(d.prefs ?? {}), [userId]: prefs };
    this.flush();
  }
  async rateHit(key: string, windowStart: number, windowMs: number) {
    const d = await this.load();
    d.rates ??= {};
    const cur = d.rates[key];
    const next = cur && cur.start === windowStart ? { start: windowStart, count: cur.count + 1 } : { start: windowStart, count: 1 };
    d.rates[key] = next;
    if (Object.keys(d.rates).length > 20_000) {
      const now = Date.now();
      for (const [k, v] of Object.entries(d.rates)) if (v.start + windowMs * 2 < now) delete d.rates[k];
    }
    return next.count;
  }
  async cacheGet(key: string, maxAgeMs: number) {
    const d = await this.load();
    const hit = d.aiCache?.[key];
    return hit && hit.at + maxAgeMs > Date.now() ? hit.value : null;
  }
  async cacheSet(key: string, value: string) {
    const d = await this.load();
    d.aiCache ??= {};
    d.aiCache[key] = { at: Date.now(), value };
    const keys = Object.keys(d.aiCache);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => d.aiCache![a].at - d.aiCache![b].at).slice(0, 500)) delete d.aiCache[k];
    this.flush();
  }
  async purge(r: Retention, now = Date.now()) {
    const d = await this.load();
    if (d.aiCache) for (const [k, v] of Object.entries(d.aiCache)) if (v.at < now - 30 * 86_400_000) delete d.aiCache[k];
    const cut = (days: number) => now - days * 86_400_000;
    const before = { usage: d.usage.length, audit: d.audit.length, feedback: (d.feedback ?? []).length, prefs: Object.keys(d.prefs ?? {}).length };
    d.usage = d.usage.filter((u) => u.at >= cut(r.usageDays));
    d.audit = d.audit.filter((a) => a.at >= cut(r.auditDays));
    d.feedback = (d.feedback ?? []).filter((f) => f.at >= cut(r.feedbackDays));
    d.prefs = Object.fromEntries(Object.entries(d.prefs ?? {}).filter(([, p]) => p.updatedAt >= cut(r.prefsDays)));
    for (const [u, seen] of Object.entries(d.users)) if (seen < cut(r.auditDays)) delete d.users[u];
    d.purgedAt = now;
    this.flush();
    return { usage: before.usage - d.usage.length, audit: before.audit - d.audit.length, feedback: before.feedback - d.feedback.length, prefs: before.prefs - Object.keys(d.prefs).length };
  }
}

/* ---------- PostgreSQL backend ---------- */
class PgBackend implements Backend {
  kind = "postgres";
  private pool: import("pg").Pool | null = null;
  private ready: Promise<void> | null = null;

  private async init() {
    if (!this.ready) {
      this.ready = (async () => {
        const { Pool } = await import("pg");
        this.pool = new Pool({ connectionString: env.databaseUrl, max: 5 });
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS usage_events (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL, tool TEXT NOT NULL, ok BOOLEAN NOT NULL, ms INTEGER NOT NULL, files INTEGER NOT NULL DEFAULT 0, cancelled BOOLEAN NOT NULL DEFAULT FALSE, user_id TEXT);
          CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events (at);
          CREATE TABLE IF NOT EXISTS audit_events (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, ip TEXT);
          CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at);
          CREATE TABLE IF NOT EXISTS feedback (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL, from_id TEXT NOT NULL, kind TEXT NOT NULL, tool TEXT NOT NULL DEFAULT '', message TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS users_seen (user_id TEXT PRIMARY KEY, last_seen TIMESTAMPTZ NOT NULL);
          CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
          CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
          CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL, value TEXT NOT NULL);
        `);
      })();
    }
    await this.ready;
    return this.pool!;
  }
  async recordUsage(e: UsageEvent) {
    const p = await this.init();
    await p.query("INSERT INTO usage_events (at, tool, ok, ms, files, cancelled, user_id) VALUES (to_timestamp($1/1000.0),$2,$3,$4,$5,$6,$7)", [e.at, e.tool, e.ok, e.ms, e.files, e.cancelled, e.user ?? null]);
    if (e.user) await p.query("INSERT INTO users_seen (user_id, last_seen) VALUES ($1, to_timestamp($2/1000.0)) ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen", [e.user, e.at]);
    void maybePurge(this);
  }
  async recordAudit(e: AuditEvent) {
    const p = await this.init();
    await p.query("INSERT INTO audit_events (at, actor, action, detail, ip) VALUES (to_timestamp($1/1000.0),$2,$3,$4,$5)", [e.at, e.actor, e.action, e.detail ?? null, e.ip ?? null]);
    if (e.actor) await p.query("INSERT INTO users_seen (user_id, last_seen) VALUES ($1, to_timestamp($2/1000.0)) ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen", [e.actor, e.at]);
    void maybePurge(this);
  }
  async recordFeedback(f: FeedbackItem) {
    const p = await this.init();
    await p.query("INSERT INTO feedback (at, from_id, kind, tool, message) VALUES (to_timestamp($1/1000.0),$2,$3,$4,$5)", [f.at, f.from, f.kind, f.tool, f.message]);
  }
  async listFeedback(limit = 200) {
    const p = await this.init();
    const r = await p.query("SELECT extract(epoch from at)*1000 AS at, from_id, kind, tool, message FROM feedback ORDER BY at DESC LIMIT $1", [limit]);
    return r.rows.map((x) => ({ at: Number(x.at), from: x.from_id, kind: x.kind, tool: x.tool, message: x.message }));
  }
  async snapshot(): Promise<Snapshot> {
    const p = await this.init();
    const usage = await p.query("SELECT extract(epoch from at)*1000 AS at, tool, ok, ms, files, cancelled, user_id AS user FROM usage_events WHERE at > now() - interval '30 days' ORDER BY at DESC LIMIT $1", [MAX_USAGE]);
    const audit = await p.query("SELECT extract(epoch from at)*1000 AS at, actor, action, detail, ip FROM audit_events ORDER BY at DESC LIMIT $1", [MAX_AUDIT]);
    const users = await p.query("SELECT user_id, extract(epoch from last_seen)*1000 AS last_seen FROM users_seen");
    return {
      usage: usage.rows.map((r) => ({ ...r, at: Number(r.at) })),
      audit: audit.rows.map((r) => ({ ...r, at: Number(r.at) })),
      users: Object.fromEntries(users.rows.map((r) => [r.user_id, Number(r.last_seen)])),
    };
  }
  async listAccounts(): Promise<Account[]> {
    const p = await this.init();
    const r = await p.query("SELECT username, name, email, role, password_hash, extract(epoch from created_at)*1000 AS created_at FROM accounts ORDER BY created_at");
    return r.rows.map((x) => ({ username: x.username, name: x.name, email: x.email, role: x.role, passwordHash: x.password_hash, createdAt: Number(x.created_at) }));
  }
  async getAccount(username: string) {
    return (await this.listAccounts()).find((a) => a.username === username.toLowerCase()) ?? null;
  }
  async saveAccount(a: Account) {
    const p = await this.init();
    await p.query("INSERT INTO accounts (username, name, email, role, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT (username) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role, password_hash=EXCLUDED.password_hash", [a.username, a.name, a.email, a.role, a.passwordHash, a.createdAt]);
  }
  async deleteAccount(username: string) {
    const p = await this.init();
    await p.query("DELETE FROM accounts WHERE username = $1", [username.toLowerCase()]);
  }
  async getPrefs(userId: string) {
    const p = await this.init();
    const r = await p.query("SELECT data FROM user_prefs WHERE user_id = $1", [userId]);
    return r.rows.length ? (r.rows[0].data as UserPrefs) : null;
  }
  async savePrefs(userId: string, prefs: UserPrefs) {
    const p = await this.init();
    await p.query("INSERT INTO user_prefs (user_id, data, updated_at) VALUES ($1, $2, to_timestamp($3/1000.0)) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at", [userId, JSON.stringify(prefs), prefs.updatedAt]);
  }
  async rateHit(key: string, windowStart: number, windowMs: number) {
    const p = await this.init();
    const r = await p.query(
      "INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END, window_start = EXCLUDED.window_start RETURNING count",
      [key, windowStart],
    );
    if (Math.random() < 0.01) await p.query("DELETE FROM rate_limits WHERE window_start < $1", [Date.now() - windowMs * 2]);
    return Number(r.rows[0].count);
  }
  async cacheGet(key: string, maxAgeMs: number) {
    const p = await this.init();
    const r = await p.query("SELECT value FROM ai_cache WHERE key = $1 AND at > $2", [key, new Date(Date.now() - maxAgeMs).toISOString()]);
    return r.rows.length ? (r.rows[0].value as string) : null;
  }
  async cacheSet(key: string, value: string) {
    const p = await this.init();
    await p.query("INSERT INTO ai_cache (key, at, value) VALUES ($1, now(), $2) ON CONFLICT (key) DO UPDATE SET at = now(), value = EXCLUDED.value", [key, value]);
  }
  async purge(r: Retention, now = Date.now()) {
    const p = await this.init();
    await p.query("DELETE FROM ai_cache WHERE at < $1", [new Date(now - 30 * 86_400_000).toISOString()]);
    const ts = (days: number) => new Date(now - days * 86_400_000).toISOString();
    const u = await p.query("DELETE FROM usage_events WHERE at < $1", [ts(r.usageDays)]);
    const a = await p.query("DELETE FROM audit_events WHERE at < $1", [ts(r.auditDays)]);
    const f = await p.query("DELETE FROM feedback WHERE at < $1", [ts(r.feedbackDays)]);
    const pr = await p.query("DELETE FROM user_prefs WHERE updated_at < $1", [ts(r.prefsDays)]);
    await p.query("DELETE FROM users_seen WHERE last_seen < $1", [ts(r.auditDays)]);
    await p.query("DELETE FROM rate_limits WHERE window_start < $1", [now - 2 * 86_400_000]);
    return { usage: u.rowCount ?? 0, audit: a.rowCount ?? 0, feedback: f.rowCount ?? 0, prefs: pr.rowCount ?? 0 };
  }
}

let backend: Backend | null = null;
export function store(): Backend {
  if (!backend) backend = env.databaseUrl ? new PgBackend() : new FileBackend();
  return backend;
}
