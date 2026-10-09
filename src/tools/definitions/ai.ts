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
];
