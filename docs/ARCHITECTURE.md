# Architecture

Omnifi SuperTools is a Next.js 16 (App Router) application. The defining design choice is that **tools run in the browser by default**. The server exists for the shell, authentication, usage statistics, AI proxying and a small set of network utilities.

## Layout

```
src/
  app/                 Routes (App Router)
    api/               Route handlers: health, auth, ai, web, telemetry, admin
    tool/[id]/         One page for every registry entry
    tools/[category]/  Category listing
    workflows/         Workflow builder
    admin/             Admin dashboard (server-gated)
  components/
    layout/            Header, footer, logo, theme, command palette
    tools/             ToolRunner, dropzone, options form, progress, results
    workflows/         Builder UI
    admin/             Dashboard
    ui/                Button, Card, Input primitives (Tailwind, brand tokens)
  tools/
    registry.ts        Central registry + helpers (search, related, chaining)
    categories.ts
    definitions/       One file per category; declarative ToolDefinition objects
  processors/
    index.ts           processor id -> lazy module (code-split per family)
    pdf/ image/ media/ office/ finance/ dev/ text/ file/ web/ ai/
    shared/            canvas, pdf.js loader, zip, tables, dates, amounts, hash, diff
  lib/
    files.ts           MIME sniffing, validation, downloads
    search.ts          Fuse index over the registry + synonyms
    workflow-runner.ts Chains processors, feeding outputs to inputs
    server/            env, auth (jose sessions), ssrf, ratelimit, store, ai, web-tools
  store/               zustand stores (prefs, workflows, session)
  config/              brand tokens, site config
  types/               ToolDefinition, processor contracts
  proxy.ts             Security headers + /admin gate (Next 16 "proxy", formerly middleware)
tests/                 vitest (node)
docs/
```

## The registry

Every tool is a `ToolDefinition` (see `src/types/tool.ts`): id, name, category, keywords, accepted inputs, outputs, `processor` id, `kind` (file / text / calculator / generator), `status` (ready / coming-soon), `runtime` (browser / server), options schema, and chaining flags.

The registry powers:

- Search and the command palette (`lib/search.ts`, Fuse.js with weighted keys and synonym boosts)
- Category pages, related tools, favorites, recents
- The tool page itself. `ToolRunner` reads the definition and renders the right input surface and options form; nothing is hard-coded per tool.
- The workflow builder, which uses `accepts()` / `toolsAccepting()` to suggest compatible next steps.

Tests assert that ids are unique, every ready tool maps to an implemented processor family, and option defaults match their field types.

## Processors

A processor is a plain async function:

```ts
type FileProcessor = (files: File[], ctx: { options, onProgress?, signal? }) => Promise<ProcessorOutput>;
type TextProcessor = (input: string, ctx) => Promise<ProcessorOutput>;
type CalcProcessor = (ctx) => Promise<ProcessorOutput>;
```

`ProcessorOutput` carries output files (Blobs), optional text, structured data, human-readable stats (Original / Output / Saved) and warnings. Processors throw `ProcessorError(message, hint)` for user-facing failures.

Families are loaded lazily by `processors/index.ts`, so opening the JSON formatter never downloads pdf.js, and FFmpeg's WebAssembly core is only fetched when a media tool runs.

Engines used in the browser:

| Need | Library |
|---|---|
| PDF structure (merge, split, rotate, watermark, metadata) | pdf-lib |
| PDF rendering and text layer | pdfjs-dist (worker) |
| OCR | tesseract.js (WebAssembly, language data from CDN, self-hostable) |
| Images | Canvas / OffscreenCanvas, custom EXIF reader |
| Video & audio | @ffmpeg/ffmpeg single-thread core (no COOP/COEP needed) |
| Spreadsheets | SheetJS (xlsx), PapaParse |
| DOCX/PPTX | JSZip + OOXML parsing (no external service) |
| QR | qrcode, jsQR |
| Archives | JSZip |
| Hashes | WebCrypto + a small MD5 |

## Batch processing

`ToolRunner` treats multi-file uploads as a batch unless the tool declares `combine` (merge-type tools) or `fileCount` (compare-type tools). Each file becomes a job with its own status, progress, error and retry. A shared `AbortController` cancels the whole batch. Results are merged and downloadable individually or as one ZIP.

## Workflows

A workflow is an ordered list of `{ toolId, options }` steps stored in local storage. `lib/workflow-runner.ts` runs them sequentially, converting each step's output blobs into `File` objects for the next step and transparently unpacking intermediate ZIPs. Only chainable, browser-side file tools are offered.

## Server side

- **Auth**: signed HS256 session cookie (jose). `AUTH_MODE=local` checks scrypt-hashed accounts from env; `AUTH_MODE=header` trusts identity headers from an SSO reverse proxy. Roles: `admin` / `user`. Admin pages and stats require the admin role, verified server-side.
- **Web tools** (`/api/web`): every outbound fetch goes through `lib/server/ssrf.ts`, which allows only http(s), resolves DNS and rejects private/link-local/loopback ranges on every redirect hop, caps response bytes and enforces a timeout.
- **AI** (`/api/ai/run`): provider-agnostic client. Anthropic, OpenAI, or any OpenAI-compatible endpoint. Prompts wrap user content in `<input>` tags with an instruction to treat it as data. Keys live only in server env.
- **Store**: usage and audit events in PostgreSQL when `DATABASE_URL` is set, otherwise a JSON file under `DATA_DIR`. Only tool ids, timings and outcomes are stored.
- **Rate limiting**: sliding window per user/IP for AI, web and auth routes.

## Scaling to 300+ tools

Adding a tool is a registry entry plus one exported function (see `docs/ADDING_A_TOOL.md`). Families are code-split; a new family is one line in `processors/index.ts`. Category pages, search, favorites, palette and workflows all derive from the registry, so no UI changes are needed per tool.

Server-heavy tools (LibreOffice, headless Chrome, yt-dlp style downloaders) are declared with `runtime: "server"` and `status: "coming-soon"` until a worker service exists. The intended shape is a queue (Redis, already in `docker-compose.yml`) feeding sandboxed worker containers that receive files by opaque id and delete them after processing.
