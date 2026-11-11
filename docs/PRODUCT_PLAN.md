# Product plan

**Omnifi SuperTools.** One place for the tools you actually need.

## Why

Omnifi staff process client PDFs, statements, spreadsheets, images and recordings every day, and reach for a dozen public websites to do it. Those sites upload client documents to third parties. SuperTools replaces them with an internal platform that does the work in the employee's browser wherever possible and looks like something Omnifi shipped.

## Principles

1. Privacy first: browser-side by default; server-side only when unavoidable, with automatic deletion.
2. No fake features: a tool is either ready or clearly marked coming soon.
3. Registry-driven: adding a tool never requires UI work.
4. Omnifi branded: official logo, navy/indigo system, brand dot, restrained motion.
5. Fast for power users: command palette, shortcuts, batch, workflows.

## Reference study (not copied)

OmniTools and iLovePDF were reviewed for information architecture only: category-first discovery, one page per tool, upload → options → process → download, and a persistent search. SuperTools uses an original design and its own code.

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Branding, shell, header, nav, home, search, categories, registry, theme, responsive | Done |
| 2 | Documents (30 tools): merge, split, compress, rotate, extract, delete pages, images↔PDF, OCR, text/tables, watermark, metadata, page numbers, compare, repair, protect/unlock (real encryption), redact by search, flatten, form fields, signature, split by statement date, PDF editor, image extractor, EPUB | Done, browser-side |
| 3 | Images (21): compress, resize, convert, crop, rotate, flip, metadata, watermark, blur, pixelate, QR, favicon, palette, opacity, transparency, grid split, image to text | Done |
| 4 | Video/audio (14) via self-hosted FFmpeg WebAssembly | Done |
| 5 | Excel & CSV (26), PowerPoint (19), Word (18): conversions, cleaning, consolidation, formula explainer/audit, OOXML merge/split/replace/clean/compress/audit/compare, mail merge, Markdown/Excel to slides and documents | Done |
| 6 | Developer (25) and Text (32): formatters, validators, converters, list utilities | Done (JS formatter coming soon) |
| 7 | Finance (34): 20 calculators, statement splitter, AR aging, bank reconciliation, cleaners, duplicates, classifier, categorisation, mapping, normalisation, PDF statement to Excel, batch OCR of scans | Done |
| 8 | AI (beta, 26 tools): provider-agnostic server client (Groq default; xAI, Anthropic, Gemini, OpenAI, OpenAI-compatible), lite-model routing, 7-day cache, shared pacing, per-person allowance 15 / 3 h, admin budget view | Done; free tier, paid plan planned |
| 9 | Workflow builder | Done |
| 10 | Admin, security, performance: Microsoft sign-in, fail-closed production auth, CSP, sanitised previews, SSRF guard, rate limits, retention purge, audit, telemetry, feedback, admin dashboard with people/tools and AI budget, tool checker, Docker on Render | Done |
| 11 | Everyday (15), Checks & generators (12), Files (12), Web (11), Steps Recorder download, Tech Hub links, favorites synced per account | Done |

## Coming soon (declared, not runnable)

PDF → Word/Excel/PowerPoint, Website screenshot, HTML → PDF, Barcode tools, TAR tools, JS formatter. Each needs a server-side engine (LibreOffice, headless Chrome) that is not part of this build. The public media downloader was built and removed on 2026-10-12 and will not return (terms-of-service and copyright risk).

## Next candidates

- Paid AI plan with a stronger model once the free allowance is hit regularly (admin page shows the live budget).
- Durable store on every deployment: `DATABASE_URL` (Neon) so history, favorites and allowances survive updates.
- Tool batches from `docs/NEW_TOOL_PROPOSALS_2026-10-28.md` (subset-sum difference finder, CSV↔OFX/QBO, HEIC to JPG, lookup join, pivot-lite, MACRS, encrypted ZIP, Bates numbering, EML/MSG to PDF, Benford test, email header analyser, paper-tape adding machine).
- Worker service with LibreOffice to light up the Office conversions.
