# Deployment

## Requirements

- Node.js 24 (or Docker)
- Optional: PostgreSQL 16 for usage/audit data (falls back to a JSON file)
- Optional: an AI provider key
- Outbound access from user browsers to `cdn.jsdelivr.net` (FFmpeg core) and `tessdata.projectnaptha.com` (OCR language data), or self-host both (below)

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Set `ADMIN_PASSWORD` in `.env.local` to sign in as `admin` and see `/admin`.

## Checks

```bash
npm run check      # typecheck + lint + tests + production build
npm run typecheck
npm run lint
npm test
npm run build
```

## Docker

```bash
cp .env.example .env    # fill in SESSION_SECRET, ADMIN_PASSWORD, AI keys
docker compose up --build -d
```

This starts the app on port 3000, PostgreSQL and Redis (reserved for future worker queues). Usage data persists in the `pg-data` volume; the JSON fallback (if you remove Postgres) lives in `app-data:/data`.

Generate a session secret:

```bash
openssl rand -hex 32
```

Generate a password hash for `USERS_JSON`:

```bash
node scripts/hash-password.mjs "the password"
```

## Environment variables

See `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Required in production, 32+ chars |
| `AUTH_MODE` | `local` (accounts from env) or `header` (SSO proxy headers) |
| `ADMIN_PASSWORD`, `USERS_JSON` | Local accounts |
| `AUTH_ADMINS` | Emails granted admin in header mode |
| `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` | AI tools |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_FFMPEG_CORE_URL` | Self-hosted FFmpeg core (build-time) |

## Sharing with the team (quick options)

- **Same office network, no install:** run `npm run build && npm start` on any machine and share `http://<that machine's IP>:3000`. The app prints its network URL at start. Everyone can use every tool; the admin page is open until you set `ADMIN_PASSWORD`.
- **Proper internal hosting:** `docker compose up -d` on an internal VM, then put it behind your reverse proxy at a name like `supertools.omnifi.internal`.
- **Collecting ideas:** the footer link "Share an idea" (`/feedback`) stores notes that appear on `/admin` under Team feedback.

## Live exchange rates

`/api/rates` fetches daily rates from open.er-api.com (fallback: frankfurter.dev) and caches them for an hour. Both are keyless public feeds. If the server has no internet access, the currency converter shows a clear error and everything else keeps working.

## Behind a reverse proxy / SSO

Put the app behind Azure AD Application Proxy, oauth2-proxy or similar, set `AUTH_MODE=header`, and make sure the proxy **sets** `x-forwarded-email` / `x-forwarded-user` and **strips** any such headers coming from clients. List administrator emails in `AUTH_ADMINS`.

Terminate TLS at the proxy. The app sets HSTS in production.

## Self-hosting the WebAssembly engines (recommended on the intranet)

FFmpeg core:

```bash
mkdir -p public/ffmpeg
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.{js,wasm} public/ffmpeg/
```

Set `NEXT_PUBLIC_FFMPEG_CORE_URL=/ffmpeg` at build time (it is inlined into the client bundle), then remove `https://cdn.jsdelivr.net` from `connect-src` in `src/proxy.ts`.

OCR language data: tesseract.js downloads `<lang>.traineddata.gz` from `tessdata.projectnaptha.com`. To self-host, download the files you need into `public/tessdata/` and pass `langPath: "/tessdata"` to `createWorker` in `src/processors/pdf/index.ts`; then drop the host from `connect-src`.

## Scaling

- The app is stateless apart from the JSON store; run several replicas against PostgreSQL.
- Rate limiting is per instance. For fairness across replicas, back it with Redis (interface in `lib/server/ratelimit.ts`).
- Browser processing means server CPU stays low; the heavy lifting happens on employee machines.

## Adding server-side converters later

LibreOffice, Poppler and similar engines are intentionally absent from this image (they are also not installed on the machine this was built on). When needed:

1. Build a worker image with the engine installed, running as a non-root user.
2. Accept jobs from Redis; receive files into a per-job temp directory; call the engine with `execFile` and an argument array; write results back; delete the temp directory in `finally`.
3. Add the tool to the registry with `runtime: "server"` and flip `status` to `ready` only once the worker is deployed.

## Health

`GET /api/health` returns registry counts, AI configuration status and storage backend. The Docker image uses it for `HEALTHCHECK`.
