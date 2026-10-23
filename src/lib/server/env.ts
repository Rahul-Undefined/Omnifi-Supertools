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
  /** Header SSO is only honoured when the proxy also sends this shared secret in X-Omnifi-Proxy-Secret (32+ chars). */
  authProxySecret: str("AUTH_PROXY_SECRET"),
  /** Believe X-Forwarded-For / X-Real-IP (for rate limiting). Only behind a proxy you control, e.g. Render. */
  trustProxyHeaders: ["1", "true", "yes", "render"].includes(str("TRUST_PROXY_HEADERS", "").toLowerCase()),
  adminUser: str("ADMIN_USER", "admin"),
  adminPassword: str("ADMIN_PASSWORD"),
  usersJson: str("USERS_JSON"),
  /** Session length when "Keep me signed in" is ticked (days). */
  rememberDays: Number(str("SESSION_REMEMBER_DAYS", "30")),
  /** Microsoft 365 sign-in (Entra ID app registration). */
  azureClientId: str("AZURE_CLIENT_ID"),
  azureClientSecret: str("AZURE_CLIENT_SECRET"),
  azureTenantId: str("AZURE_TENANT_ID", "common"),
  /** Only these email domains may sign in with Microsoft (comma separated). Empty = any. */
  allowedDomains: str("AUTH_ALLOWED_DOMAINS", "myomnifi.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Emails that get the admin role on Microsoft sign-in (comma separated). */
  adminEmails: str("ADMIN_EMAILS", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Public base URL for OAuth redirects (e.g. https://omnifi-supertools.onrender.com). Derived from the request when empty. */
  appUrl: str("APP_URL"),
  /** AI */
  aiProvider: str("AI_PROVIDER") as "" | "anthropic" | "openai" | "openai-compatible" | "gemini",
  aiModel: str("AI_MODEL"),
  anthropicKey: str("ANTHROPIC_API_KEY"),
  geminiKey: str("GEMINI_API_KEY") || str("GOOGLE_API_KEY"),
  openaiKey: str("OPENAI_API_KEY"),
  openaiBaseUrl: str("OPENAI_BASE_URL", "https://api.openai.com/v1"),
  aiMaxInputChars: Number(str("AI_MAX_INPUT_CHARS", "120000")),
  /** Cheaper model for short, simple tasks (free-tier friendly). Empty = use AI_MODEL for everything. */
  aiModelLite: str("AI_MODEL_LITE"),
  /** Whole-server pacing so the free tier's requests-per-minute / per-day limits are never exceeded. 0 disables. */
  aiGlobalPerMin: Number(str("AI_GLOBAL_PER_MIN", "8")),
  aiGlobalPerDay: Number(str("AI_GLOBAL_PER_DAY", "200")),
  /** Identical requests are answered from a cache for this many days (0 disables). */
  aiCacheDays: Number(str("AI_CACHE_DAYS", "7")),
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
  /** Daily quotas per user (or per client IP when anonymous). 0 disables. */
  quotaAiPerDay: Number(str("QUOTA_AI_PER_DAY", "300")),
  /** Per-person AI allowance: N requests per window (like a chat assistant's "15 messages per 3 hours"). Cache hits are free. */
  aiUserQuota: Number(str("AI_USER_QUOTA", "15")),
  aiUserWindowHours: Number(str("AI_USER_WINDOW_HOURS", "3")),
  quotaWebPerDay: Number(str("QUOTA_WEB_PER_DAY", "2000")),
  /** Steps Recorder desktop app: shared app token (32+ chars) and per-computer AI SOP allowance. */
  stepsRecorderToken: str("STEPS_RECORDER_TOKEN"),
  stepsRecorderQuota: Number(str("STEPS_RECORDER_QUOTA", "5")),
  stepsRecorderWindowHours: Number(str("STEPS_RECORDER_WINDOW_HOURS", "5")),
  stepsRecorderMaxImages: Number(str("STEPS_RECORDER_MAX_IMAGES", "40")),
  /** Retention in days; records older than this are purged automatically. */
  retentionUsageDays: Number(str("RETENTION_USAGE_DAYS", "90")),
  retentionAuditDays: Number(str("RETENTION_AUDIT_DAYS", "180")),
  retentionFeedbackDays: Number(str("RETENTION_FEEDBACK_DAYS", "365")),
  retentionPrefsDays: Number(str("RETENTION_PREFS_DAYS", "365")),
};

export function requireSessionSecret(): string {
  if (env.sessionSecret && env.sessionSecret.length >= 32) return env.sessionSecret;
  if (env.isProd) throw new Error("SESSION_SECRET must be set (32+ chars) in production");
  // Deterministic dev fallback so sessions survive hot reloads.
  return "dev-only-secret-change-me-dev-only-secret-change-me";
}
