import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

/**
 * Usage + audit store. Uses PostgreSQL when DATABASE_URL is set, otherwise a
 * JSON file under DATA_DIR so the app works with zero infrastructure.
 * Only tool ids, timings and outcomes are stored: never file names or contents.
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
}

const MAX_USAGE = 20_000;
const MAX_AUDIT = 5_000;

interface Backend {
  recordUsage(e: UsageEvent): Promise<void>;
  recordAudit(e: AuditEvent): Promise<void>;
  snapshot(): Promise<Snapshot>;
  listAccounts(): Promise<Account[]>;
  getAccount(username: string): Promise<Account | null>;
  saveAccount(a: Account): Promise<void>;
  deleteAccount(username: string): Promise<void>;
  getPrefs(userId: string): Promise<UserPrefs | null>;
  savePrefs(userId: string, prefs: UserPrefs): Promise<void>;
  kind: string;
}

/* ---------- JSON file backend ---------- */
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
      await writeFile(this.file, JSON.stringify(this.data));
    }).catch((e) => console.error("store flush failed", e));
  }
  async recordUsage(e: UsageEvent) {
    const d = await this.load();
    d.usage.push(e);
    if (d.usage.length > MAX_USAGE) d.usage.splice(0, d.usage.length - MAX_USAGE);
    if (e.user) d.users[e.user] = e.at;
    this.flush();
  }
  async recordAudit(e: AuditEvent) {
    const d = await this.load();
    d.audit.push(e);
    if (d.audit.length > MAX_AUDIT) d.audit.splice(0, d.audit.length - MAX_AUDIT);
    if (e.actor) d.users[e.actor] = e.at;
    this.flush();
  }
  async snapshot() {
    return structuredClone(await this.load());
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
          CREATE TABLE IF NOT EXISTS users_seen (user_id TEXT PRIMARY KEY, last_seen TIMESTAMPTZ NOT NULL);
          CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
          CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
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
  }
  async recordAudit(e: AuditEvent) {
    const p = await this.init();
    await p.query("INSERT INTO audit_events (at, actor, action, detail, ip) VALUES (to_timestamp($1/1000.0),$2,$3,$4,$5)", [e.at, e.actor, e.action, e.detail ?? null, e.ip ?? null]);
    if (e.actor) await p.query("INSERT INTO users_seen (user_id, last_seen) VALUES ($1, to_timestamp($2/1000.0)) ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen", [e.actor, e.at]);
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
}

let backend: Backend | null = null;
export function store(): Backend {
  if (!backend) backend = env.databaseUrl ? new PgBackend() : new FileBackend();
  return backend;
}
