# Omnifi SuperTools

One place for the tools you actually need.

An internal Omnifi platform for converting, editing, analysing and automating files: PDFs, images, video and audio, Excel and CSV, Word and PowerPoint, finance and bookkeeping helpers, text and developer utilities, web checks and AI-assisted writing. Almost every tool runs entirely in the browser, so client documents never leave the employee's machine.

Live: https://omnifi-supertools.onrender.com. Sign in with Microsoft 365, or request an account with your email (an administrator approves it).

## What is in the box (November 2026)

- **295 working tools across 14 categories**, driven by one registry (`src/tools`); 9 more are declared "coming soon" and never pretend to run.
- **Documents (30):** merge, split, compress, rotate, extract/delete pages, images to PDF and back, OCR, text and table extraction, watermark, metadata, page numbers, compare, repair, protect and unlock (real AES/RC4 encryption), redact by search, flatten, form fields, signature stamp, split by statement date, PDF editor, image extractor, PDF to EPUB.
- **Images (21):** compress, resize, convert, crop, rotate, flip, metadata view/strip, watermark, blur, pixelate, QR generate/read, favicon set, colour palette, opacity, colour to transparent, split into grid, image to text.
- **Video and audio (14):** FFmpeg WebAssembly in the browser: convert, compress, trim, merge, extract audio, audio convert/compress/cut/merge, GIF both ways, thumbnails, frames, metadata. Self-hosted engine, no CDN.
- **Excel and CSV (26):** CSV/Excel conversions, dedupe, clean, split/merge columns, merge sheets, extract sheets, compare, date and data formatting, multi-file consolidator, formula explainer and debugger, formula audit, CSV to JSON/XML/YAML, transpose, incomplete rows.
- **PowerPoint (19) and Word (18):** text, image and notes extraction, merge, split, find and replace, font and colour replace, clean copy for clients, compress, link check, Markdown and Excel to slides/documents, agenda generator, chart slides, deck and document audit, compare, mail merge, header/footer stamp, accept tracked changes, tables to Excel.
- **Finance (34):** 20 calculators (sales tax, mileage, payment terms, proration, business days, allocation, margin, markup, loans, amortization, interest, CAGR, IRR, NPV, ROI, break-even, depreciation) plus statement splitter, AR aging, bank reconciliation matcher, transaction and bank-statement cleaners, duplicate detector, debit/credit classifier, categorisation and account mapping helpers, date and amount normalisation, PDF statement to Excel, batch OCR of scanned statements.
- **Text (32), Developer (25), Files (12), Everyday (15), Checks and generators (12):** formatters, validators, converters, list utilities, find and replace, hashes, JWT, cron, colours, unit and time-zone converters, number to words, timesheet decimals, password tool, test data generator, readability and AI-writing checks, zip/tar/hash/split/merge/rename.
- **AI (beta, 26):** prompt builder (plain words in, a complete structured prompt out), summarise, document Q&A, action items, structured and table extraction, translate, rewrite, proofread, meeting notes, compare, text to JSON, regex and SQL assistants, code explanation, email reply, subject lines, jargon explainer, reformat, client update, agenda from notes, journal narration, variance commentary, transaction categorisation. Provider-agnostic server client (Groq by default; xAI Grok, Anthropic, Gemini, OpenAI and OpenAI-compatible supported). Every person gets 15 requests per 3 hours; identical requests are served from a 7-day cache; the whole server is paced inside the provider's free allowance.
- **Workflows:** chain tools such as OCR → Extract tables → CSV to Excel, save, run, duplicate, share templates.
- **Steps Recorder:** a Windows desktop recorder (screen video plus click-by-click HTML/Word report) downloadable from `/downloads`.
- **Power-user shell:** command palette (`Ctrl+K`), favorites and recents synced to the signed-in account, light/dark/system theme, batch processing with per-file progress, cancel and retry.
- **Sign-in:** Microsoft 365 for Omnifi staff; "Request an account" (name, email, password) for contractors and others, approved by an administrator with one click; named accounts can also be created by an admin.
- **Admin:** usage, popular tools, failures, processing time, **People & tools** (every person with the tools they used, distinct tools, AI runs), AI usage per person and per task, **live provider budget** (tokens used today, requests and tokens remaining per model), account requests waiting for approval, audit log, team feedback, system health, backup status, and a **tool checker** that runs every tool on freshly generated random input and reports what works.
- **Data that survives deploys without a database:** the server keeps its usage, favourites, accounts and AI allowances in a private GitHub data repository (restored on boot, snapshot every hour and on shutdown) and publishes a daily Excel export (people summary, people × tools, events, AI usage, feedback, users). PostgreSQL (`DATABASE_URL`) remains an alternative.
- **Security and privacy:** Microsoft sign-in, fail-closed production auth, CSP and security headers, sanitised and sandboxed previews, DNS-pinned SSRF guard, durable rate limits and quotas, retention purge, no file contents stored or logged. Full write-up on `/trust` and in `docs/SECURITY.md`.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional: set ADMIN_PASSWORD to enable /admin
npm run dev
```

Open http://localhost:3000.

## Commands

```bash
npm run dev         # development server
npm run build       # production build (standalone output)
npm start           # run the production build
npm run typecheck   # tsc
npm run lint        # eslint
npm test            # vitest (206 tests)
npm run check       # all of the above
```

## Documentation

- [Release notes](docs/RELEASE_NOTES.md) — what changed, by date
- [Product plan](docs/PRODUCT_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md) — Render, environment variables, GitHub data backup, Postgres, AI providers, tool checker
- [Adding a tool](docs/ADDING_A_TOOL.md)
- [Brand guide](docs/OMNIFI_BRAND_GUIDE.md)
- [New tool proposals (research, 2026-10-28)](docs/NEW_TOOL_PROPOSALS_2026-10-28.md)

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, zustand, cmdk, Fuse.js, pdf-lib (+ encrypt/decrypt forks), pdf.js, tesseract.js, FFmpeg WebAssembly, SheetJS, JSZip, DOMPurify, undici, jose, zod, vitest. Hosted on Render (Docker); durable data via a private GitHub data repository or PostgreSQL.
