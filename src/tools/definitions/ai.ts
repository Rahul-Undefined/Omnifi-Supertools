import type { ToolDefinition } from "@/types/tool";

/**
 * AI tools call /api/ai/run on the server. The provider and API key live in
 * environment variables and are never sent to the browser. If no provider is
 * configured the tool page shows a clear "not configured" state instead of
 * pretending to work.
 */
const ai = (
  id: string,
  name: string,
  description: string,
  keywords: string[],
  task: string,
  icon: string,
  extra: Partial<ToolDefinition> = {},
): ToolDefinition => ({
  id,
  name,
  category: "ai",
  description,
  keywords,
  input: [],
  output: ["txt"],
  processor: `ai.${task}`,
  kind: "text",
  status: "ready",
  runtime: "server",
  icon,
  inputLabel: "Text",
  ...extra,
});

const lang = { type: "text" as const, key: "language", label: "Target language", default: "Spanish" };

export const aiTools: ToolDefinition[] = [
  ai("ai-summarize", "Text summarizer", "Condense long text into a short summary or bullet points.", ["summarize", "summary", "tl;dr", "condense"], "summarize", "AlignLeft", { options: [{ type: "select", key: "style", label: "Style", default: "bullets", options: [{ value: "bullets", label: "Bullet points" }, { value: "paragraph", label: "One paragraph" }, { value: "executive", label: "Executive summary" }] }] }),
  ai("ai-document-summarizer", "Document summarizer", "Upload a PDF, DOCX or text file and get a summary.", ["summarize document", "pdf summary", "docx summary"], "summarizeFile", "FileText", { kind: "file", input: ["pdf", "docx", "txt", "md"], multiple: true }),
  ai("ai-document-qa", "Document Q&A", "Ask questions about an uploaded document.", ["question", "answer", "ask", "document qa", "chat with pdf"], "documentQa", "MessageCircleQuestion", { kind: "file", input: ["pdf", "docx", "txt", "md"], options: [{ type: "textarea", key: "question", label: "Your question", default: "" }] }),
  ai("ai-action-items", "Extract action items", "Pull tasks, owners and due dates out of notes or emails.", ["action items", "tasks", "todo", "follow ups"], "actionItems", "ListChecks"),
  ai("ai-extract-structured", "Extract structured data", "Turn unstructured text into JSON matching a schema you describe.", ["extract", "structured", "json", "fields", "entities"], "extractStructured", "Braces", { output: ["json"], options: [{ type: "textarea", key: "schema", label: "Fields to extract", default: "vendor, invoice_number, invoice_date, due_date, total, currency" }] }),
  ai("ai-extract-tables", "Extract tables", "Find tables in text and return them as CSV.", ["tables", "csv", "extract"], "extractTables", "Table2", { output: ["csv"] }),
  ai("ai-translate", "Translate", "Translate text between languages.", ["translate", "language", "spanish", "french"], "translate", "Languages", { options: [lang] }),
  ai("ai-rewrite", "Rewrite", "Rewrite text in a chosen tone.", ["rewrite", "rephrase", "tone", "simplify"], "rewrite", "PenLine", { options: [{ type: "select", key: "tone", label: "Tone", default: "professional", options: [{ value: "professional", label: "Professional" }, { value: "concise", label: "Concise" }, { value: "friendly", label: "Friendly" }, { value: "simple", label: "Plain English" }] }] }),
  ai("ai-proofread", "Proofread", "Fix spelling, grammar and punctuation, and explain the changes.", ["proofread", "grammar", "spelling", "edit"], "proofread", "SpellCheck"),
  ai("ai-meeting-notes", "Meeting notes", "Turn a transcript into a structured summary with decisions and next steps.", ["meeting", "notes", "transcript", "minutes"], "meetingNotes", "NotebookPen"),
  ai("ai-compare-documents", "Document comparison", "Explain the substantive differences between two texts.", ["compare", "differences", "versions"], "compareDocs", "GitCompare", { inputLabel: "Document A", options: [{ type: "textarea", key: "b", label: "Document B", default: "" }] }),
  ai("ai-text-to-json", "Text to JSON", "Convert free text or a list into well-formed JSON.", ["json", "convert", "structure"], "textToJson", "Braces", { output: ["json"] }),
  ai("ai-regex-assistant", "Regex assistant", "Describe what to match and get a tested regular expression.", ["regex", "pattern", "assistant"], "regexAssistant", "Regex", { inputLabel: "What should it match?" }),
  ai("ai-sql-assistant", "SQL assistant", "Describe a query in plain English and get SQL, or explain existing SQL.", ["sql", "query", "assistant", "explain sql"], "sqlAssistant", "Database", { options: [{ type: "text", key: "dialect", label: "Dialect", default: "PostgreSQL" }, { type: "textarea", key: "schema", label: "Schema (optional)", default: "" }] }),
  ai("ai-code-explain", "Code explanation", "Explain what a piece of code does, step by step.", ["explain code", "code", "understand"], "codeExplain", "Code2", { inputLabel: "Code" }),
  // Free-tier friendly everyday tools: short outputs on the lite model, cached, one request per run.
  ai("ai-email-reply", "Email reply drafter", "Paste an email, say what you want the reply to achieve, get a ready-to-send draft with a subject line. Short output on the quick model.", ["email reply", "draft email", "respond to client", "write back"], "emailReply", "MailOpen", { inputLabel: "The email you received", options: [{ type: "text", key: "goal", label: "What should the reply achieve?", default: "acknowledge and answer", placeholder: "ask for the missing bank statements by Friday" }, { type: "select", key: "tone", label: "Tone", default: "professional and warm", options: [{ value: "professional and warm", label: "Professional, warm" }, { value: "formal", label: "Formal" }, { value: "brief and direct", label: "Brief and direct" }, { value: "apologetic but confident", label: "Apologetic, confident" }] }, { type: "select", key: "length", label: "Length", default: "short", options: [{ value: "two sentences", label: "Two sentences" }, { value: "short", label: "Short" }, { value: "detailed", label: "Detailed" }] }, { type: "text", key: "signoff", label: "Sign off as", default: "the Omnifi team" }] }),
  ai("ai-subject-lines", "Subject line suggestions", "Five subject lines for an email, from direct to friendly. Tiny request, quick model.", ["subject line", "email subject", "title for email"], "subjectLines", "Heading", { inputLabel: "Email body" }),
  ai("ai-explain-jargon", "Explain this term", "Plain-English explanation of an accounting, tax or tech term with a small-business example.", ["explain", "what does mean", "jargon", "accounting term", "define"], "explainJargon", "BookOpen", { inputLabel: "Term or sentence", options: [{ type: "select", key: "depth", label: "Depth", default: "two or three sentences", options: [{ value: "one sentence", label: "One sentence" }, { value: "two or three sentences", label: "Short" }, { value: "a short paragraph with a worked example", label: "Detailed" }] }] }),
  ai("ai-reformat", "Reformat text", "Turn messy notes into bullets, steps, prose or a table without changing the facts.", ["reformat", "bullets to paragraph", "notes to table", "clean up notes", "restructure"], "reformat", "ListTree", { options: [{ type: "select", key: "mode", label: "Output as", default: "bullets", options: [{ value: "bullets", label: "Bullet points with headings" }, { value: "steps", label: "Numbered steps" }, { value: "prose", label: "Paragraphs" }, { value: "table", label: "Table" }] }] }),
  ai("ai-client-update", "Client update writer", "Internal notes in, client-ready status update out: what was done, what we need from them, next steps.", ["client update", "status update", "client email", "progress note"], "clientUpdate", "Send", { inputLabel: "Internal notes", options: [{ type: "select", key: "format", label: "Format", default: "email", options: [{ value: "email", label: "Email" }, { value: "Teams message", label: "Teams message" }, { value: "portal note", label: "Portal note" }] }, { type: "number", key: "words", label: "Max words", default: 180, min: 60, max: 400 }] }),
  ai("ai-agenda", "Agenda from notes", "Rough notes become a time-boxed meeting agenda with owners.", ["agenda", "meeting plan", "time box"], "agendaFromNotes", "CalendarClock", { options: [{ type: "number", key: "minutes", label: "Meeting length (minutes)", default: 30, min: 10, max: 180 }] }),
  ai("ai-journal-narration", "Journal entry helper", "Describe adjustments in plain words; get suggested debit/credit accounts and memo lines as CSV for review. Never posts anything.", ["journal entry", "debit credit", "adjusting entry", "memo line", "bookkeeping"], "journalNarration", "BookMarked", { output: ["csv"], inputLabel: "One adjustment per line" }),
  ai("ai-variance-commentary", "Variance commentary", "Paste a budget-vs-actual or period-over-period table (CSV) and get management-report commentary plus questions for the client.", ["variance", "budget vs actual", "commentary", "management report", "flux analysis"], "varianceCommentary", "TrendingUp", { inputLabel: "Table as CSV", options: [{ type: "select", key: "audience", label: "Audience", default: "client owner", options: [{ value: "client owner", label: "Client owner" }, { value: "internal reviewer", label: "Internal reviewer" }, { value: "board", label: "Board" }] }, { type: "select", key: "length", label: "Length", default: "5-8 bullets", options: [{ value: "3-4 bullets", label: "Brief" }, { value: "5-8 bullets", label: "Standard" }, { value: "a one-page narrative", label: "One page" }] }] }),
  ai("ai-categorize-transactions", "Categorise transactions (spreadsheet)", "Upload a CSV/XLSX of transactions; every description is categorised in ONE request and returned as CSV with a confidence column for review.", ["categorize transactions", "bank feed", "coding", "classify expenses", "bookkeeping categories"], "categorizeTransactions", "Tags", { kind: "file", input: ["csv", "xlsx", "xls"], output: ["csv"], multiple: true, options: [{ type: "text", key: "column", label: "Description column header", default: "Description" }, { type: "textarea", key: "categories", label: "Categories (comma separated)", default: "Advertising, Bank fees, Contractors, Insurance, Meals, Office supplies, Payroll, Professional fees, Rent, Software, Taxes, Travel, Utilities, Owner draw, Transfer, Income, Uncategorised" }] }),
  ai("ai-variance-from-sheet", "Variance commentary (spreadsheet)", "Upload a budget-vs-actual workbook; the first sheet is sent as one request and commentary comes back.", ["variance", "budget vs actual", "commentary", "excel"], "varianceFromSheet", "TrendingUp", { kind: "file", input: ["csv", "xlsx", "xls"], options: [{ type: "select", key: "audience", label: "Audience", default: "client owner", options: [{ value: "client owner", label: "Client owner" }, { value: "internal reviewer", label: "Internal reviewer" }, { value: "board", label: "Board" }] }] }),
];
