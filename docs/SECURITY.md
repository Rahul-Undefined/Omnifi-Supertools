# Security

SuperTools processes internal Omnifi documents. The primary control is architectural: **most tools never send the file anywhere**. This document covers what the server does and how it is protected.

## Data handling

| Path | Where data goes | Retention |
|---|---|---|
| Browser tools (PDF, image, spreadsheet, text, dev, finance, files, media) | Stays in the browser tab | Gone when the tab closes |
| Web tools | URL only is sent to the server | Host name is written to the audit log |
| AI tools | Extracted text is sent to the server, then to the configured AI provider | Not stored. Audit log records task, character count and duration only |
| Telemetry | Tool id, success/failure, duration, file count | 30 days (Postgres) or last 20,000 events (file store) |

Nothing about file names or contents is written to logs or analytics. `/api/telemetry` validates its input with a strict schema and drops unknown fields.

## Authentication and authorization

- Sessions: HS256 JWT in an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie. `SESSION_SECRET` must be 32+ characters in production; the app refuses to start otherwise.
- Local accounts: passwords are scrypt-hashed (`scripts/hash-password.mjs`). Plain `ADMIN_PASSWORD` is compared in constant time and intended for bootstrap only.
- SSO: `AUTH_MODE=header` trusts `x-forwarded-user` / `x-forwarded-email` from a reverse proxy (Azure AD Application Proxy, oauth2-proxy). Only enable behind a proxy that strips those headers from client requests.
- RBAC: `admin` role required for `/admin` and `/api/admin/*`, enforced in server code (the edge proxy only redirects when no cookie exists).
- Open mode: when no accounts are configured and no SSO is set, the admin page is readable by anyone on the network and says so. The header shows no sign-in button; `/login` still works once accounts exist.
- Login is rate limited and failed attempts are audited. Unknown users burn the same scrypt time as real ones.

## CSRF

Mutating routes check that the `Origin` header matches the `Host`. Session cookies are `SameSite=Lax`. A double-submit CSRF token cookie is also issued for future form-based flows (`checkCsrf` in `lib/server/auth.ts`).

## XSS

- React escapes output by default.
- The only `dangerouslySetInnerHTML` is the Markdown preview, which runs through a sanitizer that strips scripts, iframes, inline handlers and `javascript:` URLs.
- Content Security Policy is set on every response (`src/proxy.ts`). `unsafe-eval` is required by WebAssembly engines in some browsers; `connect-src` is restricted to self plus the CDNs used for the FFmpeg core and OCR language data. Self-host those and tighten the list (see DEPLOYMENT.md).

## SSRF

All outbound requests from web tools use `lib/server/ssrf.ts`:

- Only `http:` and `https:`; no credentials in URLs.
- `localhost`, `*.localhost`, `*.local`, `*.internal` rejected before DNS.
- DNS resolved and every address checked against loopback, private, link-local, CGNAT, multicast and IPv4-mapped IPv6 ranges.
- Redirects are followed manually with the same checks on each hop (max 5).
- Response bodies are capped (`WEB_MAX_BYTES`) and requests time out (`WEB_FETCH_TIMEOUT_MS`).
- Hop-by-hop and identity headers (`Host`, `Cookie`, `Authorization`, `X-Forwarded-*`) cannot be set by the caller.

## Path traversal and file safety

- Downloads use `safeFileName`, which strips path separators, control characters and `..`.
- ZIP extraction ignores entries containing `..` and keeps only the final path segment.
- The server never writes uploaded files to disk in this build. Future worker services must receive files by opaque id into a per-job temp directory that is removed in `finally`.
- Uploads are validated by magic number as well as extension; a PDF renamed `.png` is rejected.

## Command injection

No user input reaches a shell. FFmpeg runs in WebAssembly in the browser with an argument array, never a command string, and file names inside the virtual FS are normalised to `input.<ext>`. Server-side converters (LibreOffice, Poppler) are not part of this build; when added they must use `execFile` with argument arrays, run in a sandboxed container as an unprivileged user, and be given files by path from a temp directory the app controls.

## Rate limiting and abuse

Sliding-window limits per user (or IP) for AI (`RATE_LIMIT_AI_PER_MIN`), web (`RATE_LIMIT_WEB_PER_MIN`) and auth (`RATE_LIMIT_AUTH_PER_MIN`). In-memory per instance; move to Redis for multi-instance deployments.

## Headers

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment off), `Cross-Origin-Opener-Policy: same-origin`, HSTS in production, and CSP as above.

## AI prompt injection

User content is wrapped in `<input>` tags and the system prompt instructs the model to treat it as data. Outputs are displayed as text, never executed. AI tools do not have tool-use or network access. Inputs are truncated to `AI_MAX_INPUT_CHARS`.

## Dependency hygiene

`npm audit` in CI. The build image installs with `--ignore-scripts`. Keep `pdfjs-dist`, `xlsx`, `jszip` and `@ffmpeg/*` current; they parse untrusted files.

## Reporting

Report issues to the SuperTools admin (see `/admin`). Do not file file-content examples in tickets.
