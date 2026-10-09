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

interface Snapshot {
  usage: UsageEvent[];
  audit: AuditEvent[];
  users: Record<string, number>; // userId -> last seen
}

const MAX_USAGE = 20_000;
const MAX_AUDIT = 5_000;

interface Backend {
  recordUsage(e: UsageEvent): Promise<void>;
  recordAudit(e: AuditEvent): Promise<void>;
  snapshot(): Promise<Snapshot>;
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
}

let backend: Backend | null = null;
export function store(): Backend {
  if (!backend) backend = env.databaseUrl ? new PgBackend() : new FileBackend();
  return backend;
}
