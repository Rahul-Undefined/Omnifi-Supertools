# Omnifi SuperTools: new-tool proposals (gap analysis against the 303 existing tools)

Date: 2026-10-28. Sources actually fetched and checked: IT-Tools tool registry (github.com/CorentinTh/it-tools, `src/tools/index.ts`), CyberChef operation catalogue (github.com/gchq/CyberChef, `src/core/config/Categories.json`), BentoPDF browser-only PDF toolkit feature list (github.com/alam00000/bentopdf), Stirling-PDF README + docs search (github.com/Stirling-Tools/Stirling-PDF), 10015.io tool index, calculator.net financial calculator index, awesome-selfhosted Document Management section. Where no page could be verified the source column says "general knowledge". OmniTools was skipped as instructed.

Every proposal was checked against the existing list by name and description (not just id). Items that overlap are in section 2.

## 1. Proposed tools (65)

Feasibility legend: "pure JS" = no library needed; libraries named are MIT/Apache/BSD unless noted. Everything listed runs in the browser with no server and no paid API.

### A. PDF (14)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| Remove blank pages | Detects and deletes empty or near-empty pages (scanner feed blanks) with a sensitivity slider and preview. | Stirling-PDF "Remove Blank pages", BentoPDF | pdf.js render to canvas, measure ink coverage; rebuild with pdf-lib | High |
| N-up & booklet imposition | Print 2/4/6 PDF pages per sheet, or reorder into a fold-in-half booklet. | BentoPDF "N-Up PDF", "PDF Booklet"; Stirling | pdf-lib `embedPage` onto new pages | Med |
| Bates numbering | Stamp sequential IDs (prefix + zero-padded number + suffix) across one or many PDFs, continuing the sequence file to file. | BentoPDF / Stirling "Bates Numbering" | pdf-lib text drawing (same engine as Add page numbers) | High |
| PDF header & footer stamp | Add CONFIDENTIAL / DRAFT / client name / date header and footer lines to many PDFs at once. | Stirling "Header & Footer"; mirrors existing DOCX tool | pdf-lib | High |
| Page utilities (reverse, insert blank, duplicate) | Reverse page order, insert a blank page at position N, duplicate chosen pages. | BentoPDF "Reverse Pages", "Add Blank Page" | pdf-lib copyPages / addPage | Med |
| Crop & fix page size | Crop margins (visual box) and/or scale every page to Letter / Legal / A4 so mixed scans print cleanly. | BentoPDF "Crop PDF", "Fix Page Size", "Page Dimensions" | pdf-lib setCropBox / embedPage with scale | High |
| Grayscale / ink-saver PDF | Convert a colour PDF to grayscale (and optional lower DPI) for cheap printing and smaller files. | BentoPDF "PDF to Greyscale" | pdf.js render to canvas, desaturate, re-embed as JPEG with pdf-lib (rasterises text; state this) | Med |
| Overlay PDF on PDF (letterhead) | Place one PDF (letterhead, "COPY" stamp, signature page) under or over every page of another, with opacity and position. | Stirling "Overlay PDFs" | pdf-lib embedPage + opacity | High |
| PDF attachments | Add files to a PDF as embedded attachments, or extract all embedded attachments. | BentoPDF "Add/Extract Attachments" | pdf-lib `attach()`; extraction via pdf.js `getAttachments()` | Med |
| Bookmark & outline editor | View, add, rename and reorder bookmarks; auto-build an outline from detected headings. | BentoPDF "Edit Bookmarks", "Table of Contents" | pdf.js `getOutline()` for read; pdf-lib low-level dictionary writes for outline (feasible, ~200 lines) | Med |
| Sanitize PDF | Strip JavaScript, embedded files, external links, form actions and metadata before sending to a client. | BentoPDF "Sanitize PDF" | pdf-lib: remove /JS, /AA, /OpenAction, /EmbeddedFiles, /Annots of subtype Link | High |
| Digital signature checker | List every digital signature in a PDF: signer name, signing time, reason, whether the document changed after signing (byte-range check); shows certificate details. | IT-Tools `pdfSignatureChecker`; BentoPDF "Validate Signature" | pdf-lib to read /Sig dictionaries + pkijs/asn1js (both MIT) to parse the PKCS#7 blob; full chain trust not attempted | High |
| PDF batch inventory | Drop 100 PDFs, get a CSV: file, pages, size, encrypted?, has text layer or scanned?, form fields?, created date. | general knowledge (Stirling "Get info on PDF") | pdf.js metadata + text-content probe | High |
| Email (EML / MSG) to PDF | Open Outlook .msg or .eml files, render headers + body + attachment list to PDF, and save the attachments. | Stirling "Email to PDF" (BentoPDF has it too) | postal-mime (MIT) for EML, @kenjiuno/msgreader (Apache-2.0) for MSG, html render to pdf-lib / jsPDF | High |

(Also feasible but intentionally left out of the table: "Create fillable form fields" is possible with pdf-lib and would complement Fill PDF form; it is a bigger UI build, rated Med.)

### B. Excel & data (12)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| Group & subtotal (pivot-lite) | Pick group-by columns and sum/count/avg columns; get a summary table (e.g. spend by vendor by month) with grand totals. | general knowledge (Excel PivotTable) | SheetJS parse + pure JS aggregation | High |
| Lookup join (VLOOKUP merge) | Join two sheets on a key column: left/inner/anti join; shows unmatched keys from each side. | general knowledge | SheetJS + pure JS | High |
| Keyed CSV / Excel diff | Compare two exports by key (invoice no., account) and report added, removed and changed rows with old/new values; cell-by-cell compare already exists, keyed compare does not. | IT-Tools `jsonDiff` pattern applied to tables | SheetJS + pure JS | High |
| Excel find & replace (batch) | Replace text across every sheet of many workbooks (client names, years, account codes); DOCX and PPTX versions exist, XLSX does not. | mirrors existing docx-find-replace | SheetJS read/write (keeps values; formulas preserved as strings) | High |
| Workbook clean copy | Remove comments, hidden sheets/rows/columns, defined names, external links and author metadata before sending a client a workbook. | mirrors existing docx-clean-copy / pptx-clean-copy | JSZip edit of xlsx XML parts (keeps formatting better than SheetJS round-trip) | High |
| Workbook inspector | List hidden sheets, very-hidden sheets, external links, defined names, data validations, comments, protected sheets, merged ranges; formula audit exists but structural audit does not. | general knowledge | JSZip + DOMParser over workbook.xml / sheet XML | Med |
| Column profiler | Per column: detected type, blanks, distinct count, min/max, sample values, suspicious values (text in a number column, dates as text). | general knowledge (data profiling) | SheetJS + pure JS | High |
| Fixed-width text to CSV | Convert legacy mainframe / bank print files with aligned columns into CSV by auto-detecting or drawing column breaks. | general knowledge (Excel Text Import Wizard) | pure JS | Med |
| Encoding & BOM fixer | Convert CSV/TXT between UTF-8, UTF-8-BOM and Windows-1252, repair mojibake (Ã© to é), normalise line endings (CRLF/LF). | CyberChef "Encode text / Decode text", "Text Encoding Brute Force" | TextDecoder/TextEncoder + ftfy-style replacement table (pure JS) | High |
| Excel damage repair | Fix columns Excel mangled: serial numbers back to dates (45123 to 2023-07-16), restore lost leading zeros (ZIP, account numbers), expand 1.23E+11 IDs. | general knowledge | SheetJS + pure JS | High |
| Running balance checker | Verify that each row's balance = previous balance + amount in a statement export; flags gaps, missing rows and sign errors. | general knowledge (statement review) | pure JS | High |
| Cross-foot checker | Check that row totals and column totals in a pasted/uploaded table agree with the detail (foots and cross-foots); shows every mismatch. | general knowledge (audit footing) | pure JS | Med |

### C. Accounting, bookkeeping & reconciliation (11)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| Find the difference (subset-sum) | Given a list of amounts and a target difference, find which transaction(s) add up to it (the classic "out by $1,234.56" problem). | general knowledge | pure JS meet-in-the-middle / DP with size cap | High |
| Benford's Law test | First-digit and first-two-digit distribution of an amount column vs Benford expectation, with chi-square and a chart. | CyberChef "Frequency distribution", "Chi Square"; general audit practice | pure JS + lightweight canvas chart | High |
| Audit sample selector | Random, systematic/interval and monetary-unit (MUS) sampling from a population with a seed, so a sample can be reproduced for workpapers. | general knowledge (AICPA sampling) | pure JS, seedable PRNG | High |
| Trial balance checker | Upload a TB: confirms debits = credits, flags accounts with abnormal balances (credit-balance assets etc.), subtotals by type from a prefix map. | general knowledge | SheetJS + pure JS | High |
| CSV to OFX / QBO | Turn a bank CSV into an OFX/QFX/QBO file that QuickBooks, Xero or Wave can import (map date/amount/description columns). | general knowledge (OFX 1.x/2.x spec is open) | pure JS string generation | High |
| OFX / QFX / QBO to CSV | Parse downloaded OFX/QFX/QBO files into a clean transaction CSV. | general knowledge | pure JS SGML/XML parse | High |
| FIFO / LIFO / weighted-average inventory | Enter purchases and sales; get COGS and ending inventory under all three methods with a layer-by-layer schedule. | general knowledge (standard bookkeeping) | pure JS | High |
| 13-week cash flow forecast | Opening cash + weekly receipts/disbursements lines, recurring items, shows weekly closing balance and lowest point; export to Excel. | general knowledge | pure JS + SheetJS export | High |
| Budget vs actual (non-AI) | Upload budget and actual columns; variance $, variance %, favourable/unfavourable flags, threshold highlighting, no AI call. | general knowledge; complements existing AI commentary tools | SheetJS + pure JS | Med |
| Working-capital metrics | DSO, DPO, DIO and cash conversion cycle from revenue, COGS, AR, AP and inventory, with period-over-period comparison. | general knowledge | pure JS | Med |
| Financial ratios calculator | Current, quick, debt-to-equity, interest coverage, gross/operating/net margin, ROA/ROE from a handful of balance-sheet and P&L inputs. | general knowledge | pure JS | Med |

### D. Tax, payroll & finance calculators (13)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| MACRS depreciation | US MACRS schedule (GDS/ADS, 3/5/7/15/27.5/39-year, half-year vs mid-quarter, optional Section 179 and bonus % as editable inputs). Existing tools cover only SL and DB. | general knowledge (IRS Pub 946 tables are public domain) | pure JS with embedded percentage tables | High |
| SYD & units-of-production depreciation | Sum-of-years-digits and units-of-production schedules to round out the depreciation set. | calculator.net "Depreciation Calculator" | pure JS | Med |
| FICA, Medicare & self-employment tax | Employee/employer FICA, additional Medicare, and SE tax with the wage base and rates as editable fields (defaults shown with the year they apply to). | general knowledge | pure JS | High |
| Quarterly estimated tax (safe harbor) | Compute the four 1040-ES payments from projected tax and prior-year tax using the 100% / 110% safe-harbor rules, with due dates. | general knowledge | pure JS | High |
| Gross-up calculator | Net-to-gross for bonuses and relocation payments at given federal/state/FICA rates. | general knowledge (payroll) | pure JS | High |
| Overtime & weighted-average pay | Weekly pay with FLSA 1.5x overtime, including blended rates for multiple pay rates and tip credit as an input. | general knowledge | pure JS | Med |
| PTO accrual calculator | Accrual per pay period from annual hours, caps and carry-over; projects balance by date. | general knowledge | pure JS | Med |
| 401(k) employer match | Employee contribution, employer match formula (e.g. 100% of first 3% + 50% of next 2%), annual limit check, per-paycheck amounts. | calculator.net "401K Calculator" | pure JS | Med |
| Lease present value (ASC 842) | PV of lease payments at the incremental borrowing rate, initial ROU asset and liability, and a liability amortisation schedule. | general knowledge | pure JS | High |
| Loan comparison | Up to four loans side by side: payment, total interest, APR with fees, payoff date. | calculator.net "Loan Calculator" / "APR Calculator" | pure JS | Med |
| PV / FV / annuity | Present value, future value, annuity payment and number of periods (the TVM keys), plus payback period. | calculator.net "Present/Future Value", "Payback Period" | pure JS | Med |
| Tiered commission calculator | Commission from tiered or cliff rate tables against sales figures, batch from a CSV of reps. | calculator.net "Commission Calculator" | pure JS | Med |
| Per diem calculator | M&IE and lodging per diem for a trip with the 75% first/last-day rule; rates entered by the user (no live GSA lookup). | general knowledge (GSA rules) | pure JS | Med |

### E. Validation & record clean-up (10)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| ABA routing number validator | Checks the 9-digit checksum and the Federal Reserve district prefix range; batch mode for a column. | general knowledge (public checksum algorithm) | pure JS | High |
| IBAN validator & parser | Mod-97 check, country, length and bank/branch parts for international vendor payments. | IT-Tools `ibanValidatorAndParser` | ibantools (MIT) or pure JS | Med |
| Card number Luhn check | Luhn validity and brand detection for masked-input testing of payment forms; nothing stored, nothing sent. | CyberChef "Luhn Checksum" | pure JS | Low |
| EIN format checker | Validates XX-XXXXXXX format and the known valid IRS campus prefixes; batch from a column. | general knowledge | pure JS | Med |
| Phone number formatter | Parse and normalise messy US/international numbers to E.164 or (555) 555-5555; batch a column. | IT-Tools `phoneParserAndFormatter` | libphonenumber-js (MIT) | High |
| Name parser | Split "Smith, John A. Jr." / "Dr John Smith" into first/middle/last/suffix columns, or combine them back. | general knowledge | pure JS (or `parse-full-name`, MIT) | High |
| Address standardiser | Normalise US addresses to USPS style (ST, AVE, STE, state codes, ZIP+4 split) without any API call. | general knowledge (USPS Pub 28 abbreviations) | pure JS rules table | Med |
| Fuzzy duplicate finder | Find near-duplicate customer/vendor names ("ACME Inc" vs "Acme, Inc.") using normalisation + Levenshtein/Jaro-Winkler with a threshold. | CyberChef "Fuzzy Match", "Levenshtein Distance" | pure JS | High |
| Compare two lists (set operations) | Items only in A, only in B, in both, union; case/whitespace-insensitive; paste or upload. | CyberChef "Set Union / Intersection / Difference" | pure JS | High |
| Extract patterns from text | Pull every email, phone, URL, date, dollar amount, EIN-like or invoice-number pattern out of pasted text into a table. | CyberChef "Extract email addresses / URLs / dates" | pure JS regex set | High |

### F. Images & scans (8)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| HEIC to JPG / PNG | Convert iPhone HEIC receipt photos to JPG/PNG (batch), then feed into Image to PDF. | general knowledge (very common request) | heic2any / libheif-js (WASM, MIT/LGPL) | High |
| TIFF converter | Multi-page TIFF (faxes, scanner output) to PNG/JPG or straight to PDF. | general knowledge | UTIF.js (MIT) + pdf-lib | Med |
| Signature creator | Draw or type a signature and export a transparent PNG for use with the existing Signature stamp tool. | 10015.io "Sign PDF", general | canvas (signature_pad, MIT) | High |
| Screenshot annotator | Add arrows, boxes, numbered callouts, text and highlight to a screenshot; companion to Steps Recorder. | general knowledge | fabric.js or plain canvas | High |
| Region blur / redact | Draw rectangles to blur, pixelate or black out account numbers on an image; whole-image blur exists, regions do not. | 10015.io "Photo Censor" | canvas | High |
| Receipt scan enhancer | Perspective-correct a phone photo of a receipt, auto-crop, boost contrast and output a clean B&W "scan". | general knowledge (document scanner apps) | OpenCV.js (WASM, Apache-2.0) or pure-canvas threshold; OpenCV ~8 MB loaded on first use | High |
| Brightness, contrast & grayscale | Simple adjustments and grayscale/invert for faxed or faded documents. | CyberChef "Image Brightness / Contrast", "Invert Image" | canvas filters | Med |
| SVG to PNG / PNG to SVG | Rasterise logos for letterhead, or trace a flat logo into SVG. | 10015.io "SVG to PNG Converter"; IT-Tools SVG tools | canvas for SVG to PNG; imagetracer.js (Unlicense) for PNG to SVG | Low |

### G. Developer, IT & email security (7)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| XML to JSON, TOML to JSON (and back) | Missing format pairs (CSV to XML and YAML exist; XML to JSON and TOML do not). | IT-Tools `xmlToJson`, `jsonToXml`, `tomlToJson` | fast-xml-parser (MIT), @iarna/toml (ISC) | Med |
| JSONPath / jq-style query | Filter a JSON document with JSONPath (and a tree viewer with copy-path). | CyberChef "JPath expression", "Jq"; IT-Tools `jsonViewer` | jsonpath-plus (MIT) | Med |
| HTML entities encode/decode | &amp; etc. for web and email templates. | IT-Tools `htmlEntities`; CyberChef | pure JS | Low |
| Mermaid diagram renderer | Paste Mermaid text, get a flowchart/Gantt/org chart as SVG/PNG for process documentation. | general knowledge | mermaid (MIT) | Med |
| Email header analyser | Paste raw headers: shows the Received hop chain with delays, SPF/DKIM/DMARC results, reply-to mismatch and sender-domain lookalike warnings (phishing triage for invoice-fraud emails). | general knowledge (MXToolbox-style, done locally) | pure JS parse | High |
| Safe-link decoder & URL unmasker | Decode Outlook Safe Links / Proofpoint wrappers, punycode and percent-encoding; show the real destination and warn on lookalike domains. | IT-Tools `safelinkDecoder`; CyberChef "From Punycode", "Defang URL" | pure JS (punycode.js, MIT) | High |
| Encrypted ZIP (AES-256) | Create a password-protected ZIP for sending tax documents; existing ZIP creator has no password option. | general knowledge | zip.js (BSD-3) supports AES encryption client-side | High |

### H. Everyday office (10)

| Tool name | What it does | Source / inspiration | Browser feasibility | Value |
|---|---|---|---|---|
| Paper-tape adding machine | Ten-key calculator with a running printable tape, memo per line, subtotal/total, copy tape to Excel. | general knowledge (every bookkeeper's desk) | pure JS | High |
| Billable time tracker | Start/stop timers per client/task, round to 6- or 15-minute increments, export CSV; kept in localStorage. | IT-Tools `chronometer` extended | pure JS | High |
| ICS reminder generator | Paste a list of dates and titles (tax deadlines, filing dates) and download an .ics file for Outlook/Google Calendar. | general knowledge | pure JS (ICS is plain text) | High |
| Pay-date & period-end calendar | Generate biweekly/semi-monthly pay dates, quarter-ends and month-ends for a year, shifted off weekends/holidays; export CSV/ICS. | general knowledge | pure JS | High |
| Printable calendar | Monthly/yearly calendar PDF with optional holidays and fiscal-year start. | 10015.io "Printable Calendar Generator" | pdf-lib | Low |
| Labels & envelopes from CSV | Mail-merge a client list onto Avery 5160/5162-style label sheets or #10 envelopes as PDF. | general knowledge (organiser mailings) | pdf-lib with layout presets | High |
| Fax cover / transmittal sheet | Fill in to/from/pages/notes and download a clean Omnifi-styled cover sheet PDF. | general knowledge | pdf-lib (reuse invoice-generator styling) | Med |
| Browser screen recorder | Record a tab, window or screen (with mic) to WebM/MP4 without installing the Windows app. | IT-Tools `cameraRecorder` | getDisplayMedia + MediaRecorder; MP4 via existing FFmpeg WASM | Med |
| Voice memo recorder | Quick audio note to MP3/WAV, local only. | IT-Tools `cameraRecorder` | MediaRecorder + FFmpeg WASM | Low |
| Decision matrix | Weighted scoring of options (software choices, vendors) with sensitivity to weights; export to Excel. | general knowledge | pure JS | Low |

## 2. Considered and rejected

| Candidate | Reason |
|---|---|
| PDF to PDF/A, Font to outline | Needs Ghostscript WASM (~15 MB, AGPL); BentoPDF does it, but the licence and payload are a poor fit. |
| Deskew PDF | Feasible with OpenCV.js but marginal over OCR + rotate; revisit if Receipt scan enhancer ships (same library). |
| Scanner effect (make a digital PDF look scanned) | Stirling/BentoPDF feature; main use is making documents look like something they are not. Reputational risk for an accounting firm. |
| Remove PDF metadata, Linearize PDF | Existing PDF metadata tool already edits fields; linearization has no user-visible benefit here. |
| Remove restrictions / unlock without password | Existing Unlock PDF covers the legitimate case; owner-password stripping without the password is a grey area. |
| Excel sheet/workbook password removal | Trivial XML edit but it is a protection bypass; keep out. |
| AP aging | Same engine as existing AR aging with the sign flipped; add as an option to AR aging rather than a new tool. |
| Sales tax rates by state / ZIP | Rates change constantly; a stale table gives wrong answers with real consequences. Existing calculator with a typed-in rate is the right design. |
| W-4 withholding estimator, 1099 threshold checker, income tax calculator | Annual form logic and thresholds change; high maintenance and advice risk. The proposed FICA/SE/estimated-tax tools keep rates as visible editable inputs instead. |
| Inflation adjuster, CPI tools | Needs a data feed; only accurate with live data. |
| Live per-diem / GSA lookup | Needs an API; per-diem tool proposed with user-entered rates instead. |
| TOTP / OTP generator (IT-Tools) | Storing 2FA secrets in a browser utility is bad security practice. |
| Social-media post/chat generators, Instagram/YouTube downloaders (10015.io) | Fake-screenshot generators and downloaders: legal/reputation risk; out of scope. |
| Fake IBAN generator (10015.io) | Test data generator already exists. |
| Background remover | Feasible (@imgly/background-removal, ONNX ~40 MB) but heavy and rarely needed by an accounting firm. |
| JSON / XML / YAML formatters, regex tester, case converter, lorem ipsum, text statistics, URL encode, Base64, hash, UUID, JWT, cron, markdown, colour, slug (IT-Tools, CyberChef) | Already exist (lorem ipsum: trivial, low value). |
| Email normaliser / list cleaner | Exists (Email list cleaner). |
| Number to words, timestamp, timezone, percentage, ETA | Exist or trivial. |
| Set/sort/unique/head/tail/dedupe/shuffle text ops (CyberChef) | Mostly exist in the text category; only set comparison and extractors were kept. |
| CSV to JSON/YAML/XML, JSON to CSV | Exist. |
| Image crop / resize / rotate / flip / watermark / opacity / colour-to-transparent | Exist. |
| Subnet calculators, MAC tools, Docker converters, chmod, keycodes | Developer-only; near-zero value for this audience. |

## 3. Top 15 recommendations (priority order)

1. **Find the difference (subset-sum)** - solves the most common reconciliation headache in minutes; pure JS, about a day of work.
2. **CSV to OFX/QBO and OFX/QFX to CSV** - closes the gap between bank exports and QuickBooks/Xero imports; the two directions share one parser.
3. **HEIC to JPG** - iPhone receipt photos are the number one "cannot open this" ticket; one small WASM library.
4. **Lookup join (VLOOKUP merge)** - staff do this in Excel daily with error-prone formulas; a two-file upload with key selection is faster and safer.
5. **Group & subtotal (pivot-lite)** - spend-by-vendor or revenue-by-month in two clicks without opening Excel.
6. **MACRS depreciation** - the obvious missing sibling of the SL and DB tools, and the one US clients actually need.
7. **Encrypted ZIP (AES-256)** - a safe way to send tax packets when a portal is unavailable; one option on top of the existing ZIP creator.
8. **Bates numbering and PDF header/footer stamp** - both reuse the page-number engine; audit binders and client packages need them.
9. **Email (EML/MSG) to PDF** - invoices and approvals arrive as Outlook messages and must go into the workpapers as PDF.
10. **Benford's Law test and Audit sample selector** - cheap, defensible analytics that advisory staff can put straight into workpapers.
11. **Email header analyser and Safe-link decoder** - accounting firms are prime targets for invoice-fraud phishing; both run fully offline.
12. **Paper-tape adding machine** - the single most-used device on a bookkeeper's desk, with a copyable tape.
13. **Excel find & replace (batch) and Workbook clean copy** - completes the DOCX/PPTX pattern already in the portal for the file type accountants use most.
14. **Signature creator, Region blur/redact and Screenshot annotator** - three small canvas tools that make the existing Signature stamp, Steps Recorder and Redact tools much more useful.
15. **Pay-date calendar and ICS reminder generator** - payroll calendars and filing deadlines straight into Outlook with no typing.
