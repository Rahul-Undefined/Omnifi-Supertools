# Security

SuperTools processes internal Omnifi documents. The primary control is architectural: **most tools never send the file anywhere**. This document covers what the server does and how it is protected.

## Data handling

| Path | Where data goes | Retention |
|---|---|---|
| Browser tools (PDF, image, spreadsheet, text, dev, finance, files, media) | Stays in the browser tab | Gone when the tab closes |
| Web tools | URL only is sent to the server | Host name is written to the audit log |
| AI tools | Extracted text is sent to the server, then to the configured AI provider | Not stored. Audit log records task, character count and duration only |
| Telemetry | Tool id, success/failure, duration, file count | `RETENTION_USAGE_DAYS` (90) |
| Audit log | actor, action, short technical detail, client IP for sign-ins | `RETENTION_AUDIT_DAYS` (180) |
| Team feedback | free text, stored in its own collection (never in the audit log) | `RETENTION_FEEDBACK_DAYS` (365) |
| Synced preferences | favourite / recent tool ids per user | `RETENTION_PREFS_DAYS` (365) after last update |

Nothing about file names or contents is written to logs or analytics. `/api/telemetry` validates its input with a strict schema and drops unknown fields. Retention purges run automatically (at most hourly, triggered by writes) on both the file store and PostgreSQL. Server logs never contain passwords, tokens, authorization headers, AI prompts or document content: error handling logs only error messages, and the AI client logs nothing about requests.

## Authentication and authorization

- Sessions: HS256 JWT in an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie. `SESSION_SECRET` must be 32+ characters in production; the app refuses to start otherwise.
- Local accounts: passwords are scrypt-hashed (`scripts/hash-password.mjs`). Plain `ADMIN_PASSWORD` is compared in constant time and intended for bootstrap only.
- SSO: `AUTH_MODE=header` accepts `x-forwarded-user` / `x-forwarded-email` **only** when the request also carries `X-Omnifi-Proxy-Secret` equal to `AUTH_PROXY_SECRET` (32+ chars, compared in constant time). Identity headers sent directly by a client are ignored, and header mode without the secret fails closed (503). Configure the proxy (Azure AD Application Proxy, oauth2-proxy, nginx) to add the secret header and to strip any client-supplied copy.
- RBAC: `admin` role required for `/admin` and `/api/admin/*`, enforced in server code (the edge proxy only redirects when no cookie exists).
- Sign-in gate: the edge proxy requires a valid session for every page and API except the sign-in flow, health check and static engine files. **Production always requires sign-in**: if no method is configured the app fails closed with 503 (page and APIs) rather than running open. `/api/ai/run` and `/api/web` additionally call `requireUser()` server-side, so they refuse anonymous callers even if the edge layer were bypassed. Only in development with nothing configured is the site open.
- Session secret: in production there is no fallback; without a 32+ character `SESSION_SECRET` no cookie validates.
- Microsoft sign-in uses OpenID Connect with a state + nonce cookie, verifies the ID token signature against the Microsoft JWKS and the client-id audience, and restricts to `AUTH_ALLOWED_DOMAINS`.
- "Keep me signed in" issues a 30-day cookie; otherwise the session cookie ends when the browser closes.
- Login is rate limited and failed attempts are audited. Unknown users burn the same scrypt time as real ones.

## CSRF

Mutating routes check that the `Origin` header matches the `Host`. Session cookies are `SameSite=Lax`. A double-submit CSRF token cookie is also issued for future form-based flows (`checkCsrf` in `lib/server/auth.ts`).

## XSS

- React escapes output by default; there is no `dangerouslySetInnerHTML` left in the app.
- Rendered HTML previews (Markdown preview, HTML outputs) go through DOMPurify with an explicit allowlist (`src/lib/sanitize.ts`: no scripts, handlers, SVG/MathML, forms, iframes/objects, inline CSS, `srcset`, dangerous URL schemes; links get `rel="noopener noreferrer nofollow"`) and are then shown inside an `<iframe sandbox="">` with its own `default-src 'none'` CSP. Even a sanitiser bypass cannot run script or reach the app origin. Regression vectors live in `tests/security.test.ts`.
- Content Security Policy is set on every response (`src/proxy.ts`): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:` (WebAssembly engines need `wasm-unsafe-eval`, not `unsafe-eval`), `connect-src 'self'` (all engines are self-hosted), `frame-src 'self' about:` for the sandboxed preview only, `frame-ancestors 'none'`, `object-src 'none'`. Remaining limitation: `'unsafe-inline'` for scripts is still needed by the Next.js hydration runtime; moving to per-request nonces is the next step.

## SSRF

All outbound requests from web tools use `lib/server/ssrf.ts`:

- Only `http:` and `https:`; no credentials in URLs.
- `localhost`, `*.localhost`, `*.local`, `*.internal` rejected before DNS.
- DNS resolved once; every returned address must be public (loopback, private, link-local, CGNAT, multicast, IPv4-mapped/NAT64/6to4 IPv6, metadata and `.internal`/`.local` names are refused; a mixed answer is refused).
- **DNS rebinding**: the connection is pinned to the validated address with a custom socket lookup (undici `Agent`), while the Host header and TLS SNI keep the original host name. A record that changes between check and connect cannot steer the request to an internal host.
- Redirects are followed manually with the same validation and pinning on each hop (max 5).
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

- Fixed-window limits per minute for AI (`RATE_LIMIT_AI_PER_MIN`), web (`RATE_LIMIT_WEB_PER_MIN`), auth (`RATE_LIMIT_AUTH_PER_MIN`), telemetry, feedback and preferences, plus daily quotas per user for AI (`QUOTA_AI_PER_DAY`) and web tools (`QUOTA_WEB_PER_DAY`).
- Counters live in the store: PostgreSQL (`rate_limits` table, shared across instances and restarts) when `DATABASE_URL` is set, otherwise in-process.
- The limit key is the signed-in user id; for anonymous endpoints it is the client IP, which is read from `X-Forwarded-For` (rightmost entry) **only** when `TRUST_PROXY_HEADERS` is on, i.e. behind a proxy you control such as Render. Otherwise forwarding headers are ignored.

## Headers

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, geolocation, payment, usb, bluetooth off; microphone self for dictation), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` by default, HSTS in production, and CSP as above. `/api/health` returns only `{ ok, time }`.

## AI prompt injection

User content is wrapped in `<input>` tags and the system prompt instructs the model to treat it as data. Outputs are displayed as text, never executed. AI tools do not have tool-use or network access. Inputs are truncated to `AI_MAX_INPUT_CHARS`.

## Dependency hygiene

`npm audit` in CI. The build image installs with `--ignore-scripts`. Keep `pdfjs-dist`, `xlsx`, `jszip` and `@ffmpeg/*` current; they parse untrusted files.

## Reporting

Report issues to the SuperTools admin (see `/admin`). Do not file file-content examples in tickets.
