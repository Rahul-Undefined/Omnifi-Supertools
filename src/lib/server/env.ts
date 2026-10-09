import "server-only";

/**
 * Typed access to server environment. Nothing here is ever sent to the client.
 * See .env.example for documentation of each variable.
 */
function str(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  isProd: process.env.NODE_ENV === "production",
  /** Secret used to sign session cookies. Required in production. */
  sessionSecret: str("SESSION_SECRET"),
  sessionHours: Number(str("SESSION_HOURS", "12")),
  /** Auth mode: "local" uses ADMIN_* / USERS_JSON; "header" trusts a reverse-proxy identity header (SSO). */
  authMode: str("AUTH_MODE", "local") as "local" | "header",
  headerUser: str("AUTH_HEADER_USER", "x-forwarded-user"),
  headerEmail: str("AUTH_HEADER_EMAIL", "x-forwarded-email"),
  headerAdmins: str("AUTH_ADMINS", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  adminUser: str("ADMIN_USER", "admin"),
  adminPassword: str("ADMIN_PASSWORD"),
  usersJson: str("USERS_JSON"),
  /** AI */
  aiProvider: str("AI_PROVIDER") as "" | "anthropic" | "openai" | "openai-compatible",
  aiModel: str("AI_MODEL"),
  anthropicKey: str("ANTHROPIC_API_KEY"),
  openaiKey: str("OPENAI_API_KEY"),
  openaiBaseUrl: str("OPENAI_BASE_URL", "https://api.openai.com/v1"),
  aiMaxInputChars: Number(str("AI_MAX_INPUT_CHARS", "120000")),
  /** Storage */
  databaseUrl: str("DATABASE_URL"),
  dataDir: str("DATA_DIR", ".data"),
  /** Web tools */
  webFetchTimeoutMs: Number(str("WEB_FETCH_TIMEOUT_MS", "10000")),
  webMaxBytes: Number(str("WEB_MAX_BYTES", String(2 * 1024 * 1024))),
  /** Rate limits (requests per minute per client) */
  rateAi: Number(str("RATE_LIMIT_AI_PER_MIN", "20")),
  rateWeb: Number(str("RATE_LIMIT_WEB_PER_MIN", "60")),
  rateAuth: Number(str("RATE_LIMIT_AUTH_PER_MIN", "10")),
};

export function requireSessionSecret(): string {
  if (env.sessionSecret && env.sessionSecret.length >= 32) return env.sessionSecret;
  if (env.isProd) throw new Error("SESSION_SECRET must be set (32+ chars) in production");
  // Deterministic dev fallback so sessions survive hot reloads.
  return "dev-only-secret-change-me-dev-only-secret-change-me";
}
