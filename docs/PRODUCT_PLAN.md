# Product plan

**OmniFi SuperTools.** One place for the tools you actually need.

## Why

OmniFi staff process client PDFs, statements, spreadsheets, images and recordings every day, and reach for a dozen public websites to do it. Those sites upload client documents to third parties. SuperTools replaces them with an internal platform that does the work in the employee's browser wherever possible and looks like something OmniFi shipped.

## Principles

1. Privacy first: browser-side by default; server-side only when unavoidable, with automatic deletion.
2. No fake features: a tool is either ready or clearly marked coming soon.
3. Registry-driven: adding a tool never requires UI work.
4. OmniFi branded: official logo, navy/indigo system, brand dot, restrained motion.
5. Fast for power users: command palette, shortcuts, batch, workflows.

## Reference study (not copied)

OmniTools and iLovePDF were reviewed for information architecture only: category-first discovery, one page per tool, upload → options → process → download, and a persistent search. SuperTools uses an original design and its own code.

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Branding, shell, header, nav, home, search, categories, registry, theme, responsive | Done |
| 2 | Merge, split, compress, rotate, extract, delete pages, JPG↔PDF, OCR, metadata (+ text, tables, watermark, page numbers, compare, repair) | Done, browser-side |
| 3 | Images: compress, resize, convert, crop, rotate, flip, metadata view/strip, watermark, blur, pixelate, QR generate/read, favicon, palette | Done |
| 4 | Video/audio via FFmpeg WebAssembly: convert, compress, trim, merge, extract audio, audio convert/compress/cut/merge, GIF both ways, thumbnails, frames, metadata | Done (engine loads from CDN or self-hosted) |
| 5 | Office: CSV↔Excel, dedupe, clean, split/merge columns, merge sheets, extract sheets, compare, date/data formatting; DOCX/PPTX text, images, metadata, compare; Excel/DOCX/PPTX → PDF (browser-side, reflowed) | Done |
| 6 | Developer: JSON/XML/YAML/SQL/HTML/CSS formatters, regex, URL, Base64, hashes, JWT, UUID, timestamps, cron, colour, API request builder (SSRF-guarded) | Done (JS formatter coming soon) |
| 7 | Finance: 15 calculators; transaction/bank cleaner, duplicates, debit/credit, categorisation, account mapping, date/amount normalisation, PDF statement → Excel | Done |
| 8 | AI: 15 tasks over a provider-agnostic server client (Anthropic, OpenAI, OpenAI-compatible) | Done; requires a configured key |
| 9 | Workflow builder: create, add/remove/reorder/configure steps, save, run, duplicate, favorite, templates | Done |
| 10 | Admin, security, performance | Done for this build: optional auth + RBAC (open mode when no accounts), CSP/headers, SSRF, rate limits, audit, telemetry, team feedback page, admin dashboard, Docker |
| 11 | Everyday: multi-zone time converter, world clock, live currency converter | Done |

## Coming soon (declared, not runnable)

PDF → Word/Excel/PowerPoint, Protect PDF, Redact PDF, Website screenshot, HTML → PDF, Public media downloader, Barcode tools, TAR tools, JS formatter. Each needs a server-side engine (LibreOffice, qpdf, headless Chrome, a downloader) that is not part of this build. See DEPLOYMENT.md for the worker design.

## Next candidates

- Worker service with LibreOffice + qpdf to light up the Office conversions and Protect PDF.
- Redis-backed rate limiting and job queue for multi-instance deployments.
- Per-user favorites/recents synced through the store (today: per browser).
- Workflow sharing across the team (export/import JSON is trivial; server storage needs auth for everyone).
- Interactive crop and redaction canvases.
