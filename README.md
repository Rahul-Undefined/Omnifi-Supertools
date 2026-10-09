# OmniFi SuperTools

One place for the tools you actually need.

An internal OmniFi platform for converting, editing, analysing and automating files: PDFs, images, video and audio, spreadsheets and Office documents, finance calculators, developer utilities, web checks and AI-assisted text tasks. Most tools run entirely in the browser, so client documents never leave the employee's machine.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional: set ADMIN_PASSWORD to enable /admin
npm run dev
```

Open http://localhost:3000.

## What is in the box

- 162 working tools across 10 categories, driven by one registry (`src/tools`).
- Batch processing with per-file progress, cancel, retry and download-all.
- Workflow builder: chain tools such as OCR → Extract tables → CSV to Excel.
- Command palette (`Ctrl+K`), favorites, recents, light/dark/system theme.
- Admin dashboard: usage, popular tools, failures, processing time, system health, audit log.
- Security: session auth with RBAC, CSP and security headers, SSRF guard, rate limits, magic-number file validation.
- Docker image and compose file (app + PostgreSQL + Redis).

Tools that need server engines not in this build (LibreOffice, headless Chrome, downloaders) are listed as "Coming soon" and never pretend to run.

## Commands

```bash
npm run dev         # development server
npm run build       # production build (standalone output)
npm start           # run the production build
npm run typecheck   # tsc
npm run lint        # eslint
npm test            # vitest
npm run check       # all of the above
```

## Documentation

- [Product plan](docs/PRODUCT_PLAN.md)
- [Brand guide](docs/OMNIFI_BRAND_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Adding a tool](docs/ADDING_A_TOOL.md)

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, zustand, cmdk, Fuse.js, pdf-lib, pdf.js, tesseract.js, FFmpeg WebAssembly, SheetJS, JSZip, jose, zod, vitest.
