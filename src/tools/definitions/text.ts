import type { ToolDefinition } from "@/types/tool";

const t = (
  id: string,
  name: string,
  description: string,
  keywords: string[],
  processor: string,
  icon: string,
  extra: Partial<ToolDefinition> = {},
): ToolDefinition => ({
  id,
  name,
  category: "text",
  description,
  keywords,
  input: [],
  output: ["txt"],
  processor,
  kind: "text",
  status: "ready",
  runtime: "browser",
  icon,
  ...extra,
});

export const textTools: ToolDefinition[] = [
  t("text-counter", "Word, character and line counter", "Counts words, characters, lines, sentences and reading time.", ["word count", "character count", "line count", "counter", "reading time"], "text.count", "Hash"),
  t("case-converter", "Case converter", "UPPER, lower, Title, Sentence, camelCase, snake_case, kebab-case.", ["case", "uppercase", "lowercase", "title case", "camel", "snake", "kebab"], "text.case", "CaseSensitive", {
    options: [{ type: "select", key: "to", label: "Convert to", default: "upper", options: [
      { value: "upper", label: "UPPER CASE" }, { value: "lower", label: "lower case" }, { value: "title", label: "Title Case" }, { value: "sentence", label: "Sentence case" }, { value: "camel", label: "camelCase" }, { value: "snake", label: "snake_case" }, { value: "kebab", label: "kebab-case" },
    ] }],
  }),
  t("dedupe-lines", "Remove duplicate lines", "Keep the first occurrence of each line.", ["duplicate lines", "unique", "dedupe"], "text.dedupeLines", "CopyMinus", { options: [{ type: "checkbox", key: "caseInsensitive", label: "Ignore case", default: false }, { type: "checkbox", key: "trim", label: "Trim whitespace first", default: true }] }),
  t("sort-lines", "Sort lines", "Sort alphabetically, numerically or by length.", ["sort", "order", "alphabetical", "numeric"], "text.sortLines", "ArrowDownAZ", {
    options: [
      { type: "select", key: "by", label: "Sort by", default: "alpha", options: [{ value: "alpha", label: "Alphabetical" }, { value: "natural", label: "Natural (numbers aware)" }, { value: "length", label: "Length" }] },
      { type: "checkbox", key: "desc", label: "Descending", default: false },
      { type: "checkbox", key: "caseInsensitive", label: "Ignore case", default: true },
    ],
  }),
  t("reverse-lines", "Reverse lines", "Reverse the order of lines, or reverse each line's characters.", ["reverse", "flip"], "text.reverse", "ArrowUpDown", { options: [{ type: "select", key: "mode", label: "Mode", default: "lines", options: [{ value: "lines", label: "Reverse line order" }, { value: "chars", label: "Reverse characters in each line" }] }] }),
  t("text-diff", "Text diff", "Line-by-line comparison of two texts.", ["diff", "compare", "difference"], "text.diff", "GitCompare", { inputLabel: "Original text", options: [{ type: "textarea", key: "b", label: "Changed text", default: "" }] }),
  t("text-cleaner", "Text cleaner", "Remove extra spaces, blank lines, non-printable characters and smart quotes.", ["clean", "tidy", "smart quotes", "non printable"], "text.clean", "Sparkles", {
    options: [
      { type: "checkbox", key: "collapseSpaces", label: "Collapse repeated spaces", default: true },
      { type: "checkbox", key: "blankLines", label: "Remove blank lines", default: true },
      { type: "checkbox", key: "smartQuotes", label: "Straighten smart quotes", default: true },
      { type: "checkbox", key: "nonPrintable", label: "Strip non-printable characters", default: true },
    ],
  }),
  t("whitespace-remover", "Whitespace remover", "Trim lines, remove tabs, or delete all whitespace.", ["whitespace", "trim", "spaces", "tabs"], "text.whitespace", "Eraser", { options: [{ type: "select", key: "mode", label: "Mode", default: "trim", options: [{ value: "trim", label: "Trim each line" }, { value: "all", label: "Remove all whitespace" }, { value: "leading", label: "Remove leading whitespace" }, { value: "trailing", label: "Remove trailing whitespace" }] }] }),
  t("markdown-formatter", "Markdown formatter", "Normalise headings, lists and spacing in Markdown.", ["markdown", "format", "tidy"], "text.markdownFormat", "FileText"),
  t("html-to-markdown", "HTML to Markdown", "Convert HTML to Markdown.", ["html", "markdown", "convert"], "text.htmlToMarkdown", "FileCode", { output: ["md"] }),
  t("markdown-to-html", "Markdown to HTML", "Convert Markdown to HTML.", ["markdown", "html", "convert"], "dev.markdown", "Code2", { output: ["html"] }),
  t("text-json-formatter", "JSON formatter", "Pretty-print JSON.", ["json"], "dev.jsonFormat", "Braces", { options: [{ type: "select", key: "indent", label: "Indent", default: "2", options: [{ value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }, { value: "tab", label: "Tab" }] }] }),
  t("text-xml-formatter", "XML formatter", "Indent XML.", ["xml"], "dev.xmlFormat", "Code2"),
  t("text-yaml-formatter", "YAML formatter", "Reformat YAML.", ["yaml"], "dev.yamlFormat", "FileCode"),
  t("text-regex-tester", "Regex tester", "Test a regular expression.", ["regex"], "dev.regexTest", "Regex", { options: [{ type: "text", key: "pattern", label: "Pattern", default: "\\w+" }, { type: "text", key: "flags", label: "Flags", default: "g" }] }),
];
