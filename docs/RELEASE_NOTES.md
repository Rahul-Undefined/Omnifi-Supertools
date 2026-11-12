# Release notes

Newest first. Dates are when the change went live on https://omnifi-supertools.onrender.com.

## 2026-11-12 — Email threads, Groq reasoning fix

- **New: Email thread summary (EML)** in AI (beta): save a mail chain from Outlook as .eml and get gist, people, timeline, decisions, open items with owners, amounts and documents, plus an optional reply draft. **New: Email (EML) reader** in Files: the same export as plain text with the attachment list, no AI.
- **Fix:** AI tools could return an empty file with the Groq gpt-oss models (the model spent its whole token budget on hidden reasoning; the blank answer was then cached). Reasoning effort is now set low with token headroom, an empty answer is treated as a provider error (allowance refunded, nothing cached) and blank cache entries are ignored.

## 2026-11-11 — Groq AI provider, prompt builder, admin insight, durable data

- **Request an account (self-service, admin approved):** people without an Omnifi Microsoft login click "Request an account" on the login page, enter name, email and a password; the request appears on the admin page under "Account requests waiting for approval" with Approve / Reject; after approval they sign in with that email and password via the "Sign in with username and password" button. Pending accounts cannot sign in and the login page says so. Named accounts live in the store, so the GitHub backup keeps them across deploys.

- **New AI tool: Prompt builder.** Describe what you want in plain words (any language) and get a complete prompt with Role, Context, Task, Constraints, Output format and an example, ready to paste into ChatGPT, Claude, Copilot or any SuperTools AI tool. Options for target use, answer style and prompt length. Runs on the lite model.

- **AI provider switched to Groq** (groq.com, `GROQ_API_KEY`): OpenAI-compatible endpoint, default models `openai/gpt-oss-120b` (standard) and `openai/gpt-oss-20b` (short tasks), `qwen/qwen3.8-27b` for image input. xAI Grok (`XAI_API_KEY`) is also supported; a key pasted under the wrong provider setting is routed automatically. Gemini, Anthropic, OpenAI and OpenAI-compatible remain available.
- **Free-tier safety for Groq:** one request is capped at 22,000 characters (the provider allows 8,000 tokens per minute per model); shared pacing is 6 requests per minute and 200 per day; each person keeps 15 requests per 3 hours; identical requests come from a 7-day cache.
- **Admin → People & tools:** every signed-in person with the tools they used (click a row for the full list), total runs, distinct tools, AI runs and AI tools, last active.
- **Admin → AI usage → Provider budget (live):** tokens used today and this week per model, plus the provider's own remaining requests (per day) and tokens (per minute) read from its rate-limit headers after each call.
- **Durable data without a database:** with `GITHUB_DATA_REPO` + `GITHUB_DATA_TOKEN` (a private GitHub data repository), the server restores its snapshot on boot, pushes a fresh snapshot every hour and on shutdown, and publishes a daily Excel export (`exports/usage-YYYY-MM-DD.xlsx`: people summary, people × tools, events, AI usage, feedback, users) after 23:30 IST. Admin shows the backup status with "Back up now" and "Push Excel now". `DATABASE_URL` (Postgres) remains an alternative. Without either, the admin page shows a warning.

## 2026-11-05 — AI tools marked beta

- Category, navigation, footer and `/ai` page read "AI (beta)".
- A notice opens every time an AI tool page is opened: the tools run on a free provider tier and can fail or slow down under heavy use; a paid plan with a stronger model is in progress.

## 2026-10-28 — Tool checker and research

- **Admin tool checker** (`/admin/checker`): generates random PDFs, images, scans, spreadsheets, Word and PowerPoint files, ZIPs, audio and video in the browser, runs every one of the 303 registered tools through its real processor, inspects the output (file headers, page and slide counts, replaced text, decoded values) and reports Working / with notes / Not working / Manual / Skipped with a comment. CSV and JSON export, re-run failed, toggles for media, OCR, server and AI tools.
- First full run: 226 working, 16 working with notes, 9 manual (interactive tools), 52 skipped (AI and coming-soon), 0 failing after one real fix.
- **Fix:** Extract images from PDF hung forever on images shared across pages (logos, letterheads).
- Research of 65 further tool ideas from IT-Tools, CyberChef, BentoPDF/Stirling-PDF, 10015.io and calculator.net: `docs/NEW_TOOL_PROPOSALS_2026-10-28.md`.

## 2026-10-23 — 45 tools from the OmniTools gap list, Unlock PDF rebuilt

- Text and list utilities (find and replace, hidden characters, join/split, prefix/suffix, substrings, shuffle, rotate, group, word frequency, truncate, randomise case, slug, text to table, censor, ROT13).
- Data tools: CSV to JSON/XML/YAML, separator change, transpose, swap and insert columns, incomplete rows, JSON sort keys, escape, compare, XML validator.
- Numbers and time: number to words (cheques), number statistics, sequences, random numbers, byte converter, timesheet decimals, duration converter, leap year.
- Images: opacity, colour to transparent, split into grid. PDF: interactive PDF editor, image extractor, PDF to EPUB.
- **Unlock PDF** now really decrypts RC4 and AES-128/256 files (user or owner password) instead of failing on protected statements.

## 2026-10-15 to 2026-10-20 — AI for the whole team on a free tier

- Google Gemini provider; lite-model routing for short tasks; 7-day answer cache; shared pacing; per-task input caps.
- 10 everyday AI tools (email reply, subject lines, jargon explainer, reformat, client update, agenda from notes, journal narration, variance commentary, transaction categorisation from a sheet, variance from a sheet).
- Per-person allowance of 15 requests per 3 hours tied to the Microsoft login, with a live "requests left" widget; model names visible to admins only; refund when the provider fails.
- Admin "AI usage" section: provider, masked key, limits, totals, per person, per task, recent.
- Keep-awake: the server pings itself so the Render free instance never sleeps.
- UI: removed the "Server" badge, fixed the search focus ring and the `Ctrl+K` palette.

## 2026-10-13 — Security hardening and trust page

- Production fails closed without a sign-in method; header SSO needs a proxy secret; DOMPurify plus sandboxed iframe previews; DNS-pinned SSRF guard; durable rate limits and quotas; feedback separated from the audit log; retention purge (usage 90 d, audit 180 d, feedback 365 d).
- `/trust` page: how the portal works, what is stored for how long, protection layers, AI handling, hosting and Render's certifications, honest limits.

## 2026-10-12 — PowerPoint and Word suites

- 18 PowerPoint and 18 Word tools built on an in-house OOXML layer (merge with part renumbering, split, find and replace, fonts and colours, clean copy, compress, link check, Markdown/Excel to slides and documents, audits, compare, mail merge, header/footer stamps, tracked changes). Outputs validated by opening them in real PowerPoint and Word.
- "Office" category renamed "Excel & CSV".
- Public media downloader removed the same day it was built (terms-of-service and copyright risk for the firm).

## 2026-10-11 — Excel and bookkeeping helpers, Steps Recorder, links

- Excel formula explainer and debugger, multi-file consolidator, formula audit, document batch renamer, batch OCR and statement extractor.
- Steps Recorder for Windows available from `/downloads`.
- Tech Hub (SharePoint) link in header and footer, Omnifi website and support contact in the footer, favorites synced to the signed-in account.
- Keep-awake schedule (Mon–Fri, 11:00–22:00 IST), later made permanent.
