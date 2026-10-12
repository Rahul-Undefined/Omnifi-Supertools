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
  /** Video downloader (yt-dlp + FFmpeg in the Docker image) */
  ytdlpBin: str("YTDLP_BIN", "yt-dlp"),
  ffmpegBin: str("FFMPEG_BIN", "ffmpeg"),
  /** Netscape cookies.txt content (optional) for sites that block anonymous cloud downloads. */
  ytdlpCookies: str("YTDLP_COOKIES"),
  /** Path to a cookies.txt on disk (Render "Secret Files"), preferred over the inline variable. */
  ytdlpCookiesFile: str("YTDLP_COOKIES_FILE", "/etc/secrets/cookies.txt"),
  /** Optional HTTP/SOCKS proxy used only by the downloader, e.g. a residential proxy. */
  ytdlpProxy: str("YTDLP_PROXY"),
  ytdlpExtraArgs: str("YTDLP_EXTRA_ARGS"),
  videoMaxMb: Number(str("VIDEO_MAX_MB", "1024")),
  videoTimeoutMs: Number(str("VIDEO_TIMEOUT_MIN", "15")) * 60_000,
  videoConcurrency: Number(str("VIDEO_CONCURRENCY", "2")),
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
