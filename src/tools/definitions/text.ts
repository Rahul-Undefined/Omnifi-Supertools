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
  t("markdown-to-html", "Markdown to HTML", "Convert Markdown to HTML.", ["markdown", "html", "convert"], "dev.markdown", "Code", { output: ["html"] }),
  t("text-json-formatter", "JSON formatter", "Pretty-print JSON.", ["json"], "dev.jsonFormat", "Braces", { options: [{ type: "select", key: "indent", label: "Indent", default: "2", options: [{ value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }, { value: "tab", label: "Tab" }] }] }),
  t("text-xml-formatter", "XML formatter", "Indent XML.", ["xml"], "dev.xmlFormat", "Code"),
  t("text-yaml-formatter", "YAML formatter", "Reformat YAML.", ["yaml"], "dev.yamlFormat", "FileCode"),
  t("text-regex-tester", "Regex tester", "Test a regular expression.", ["regex"], "dev.regexTest", "Regex", { options: [{ type: "text", key: "pattern", label: "Pattern", default: "\\w+" }, { type: "text", key: "flags", label: "Flags", default: "g" }] }),
  t("find-replace", "Find & replace", "Replace text with plain matching or regular expressions, whole-word and case options; $1 groups supported.", ["find and replace", "replace text", "regex replace", "substitute"], "text.findReplace", "Replace", { options: [{ type: "text", key: "find", label: "Find", default: "" }, { type: "text", key: "replace", label: "Replace with (\\n for new line)", default: "" }, { type: "checkbox", key: "caseSensitive", label: "Match case", default: false }, { type: "checkbox", key: "wholeWord", label: "Whole words only", default: false }, { type: "checkbox", key: "regex", label: "Regular expression", default: false }] }),
  t("hidden-characters", "Hidden character detector", "Finds zero-width spaces, non-breaking spaces, direction marks and other invisible characters (common in pasted text and AI output) and returns a cleaned copy.", ["hidden characters", "invisible", "zero width", "non-breaking space", "unicode", "clean paste"], "text.hiddenChars", "ScanEye", { options: [{ type: "checkbox", key: "clean", label: "Include a cleaned copy", default: true }] }),
  t("join-lines", "Join lines", "Join lines into one string with a separator of your choice.", ["join", "combine lines", "comma separated", "one line"], "text.joinLines", "TextAlignJustify", { options: [{ type: "text", key: "separator", label: "Separator (\\n, \\t allowed)", default: ", " }, { type: "checkbox", key: "trim", label: "Trim each line", default: true }, { type: "checkbox", key: "skipEmpty", label: "Skip empty lines", default: true }] }),
  t("split-text", "Split text", "Split text into lines by a separator, a regular expression, every N characters or every N words.", ["split", "separate", "chunks", "break text"], "text.splitText", "SquareSplitHorizontal", { options: [{ type: "select", key: "mode", label: "Split by", default: "separator", options: [{ value: "separator", label: "Separator" }, { value: "regex", label: "Regular expression" }, { value: "length", label: "Every N characters" }, { value: "words", label: "Every N words" }] }, { type: "text", key: "separator", label: "Separator / pattern", default: "," }, { type: "number", key: "length", label: "N", default: 80, min: 1 }, { type: "checkbox", key: "trim", label: "Trim parts", default: true }, { type: "checkbox", key: "skipEmpty", label: "Skip empty parts", default: true }] }),
  t("prefix-suffix", "Add or remove prefix / suffix", "Wrap every line with a prefix and suffix (quotes, bullets, commas) or strip them off.", ["prefix", "suffix", "wrap lines", "unwrap", "add quotes", "bullets"], "text.prefixSuffix", "TextWrap", { options: [{ type: "text", key: "prefix", label: "Prefix", default: "" }, { type: "text", key: "suffix", label: "Suffix", default: "" }, { type: "checkbox", key: "remove", label: "Remove instead of add", default: false }, { type: "checkbox", key: "skipEmpty", label: "Leave empty lines alone", default: true }] }),
  t("extract-substring", "Extract substrings", "Pull out text by position, between two markers, or by regular expression (first group).", ["substring", "extract", "between", "regex extract", "capture"], "text.extractSubstring", "TextCursor", { options: [{ type: "select", key: "mode", label: "Mode", default: "between", options: [{ value: "between", label: "Between two markers" }, { value: "regex", label: "Regular expression" }, { value: "position", label: "By position" }] }, { type: "text", key: "start", label: "Start marker", default: "" }, { type: "text", key: "end", label: "End marker", default: "" }, { type: "text", key: "pattern", label: "Regex (use a group to capture part)", default: "" }, { type: "number", key: "from", label: "From character", default: 1, min: 1 }, { type: "number", key: "length", label: "Length (0 = to end)", default: 10, min: 0 }, { type: "checkbox", key: "perLine", label: "Apply per line (position mode)", default: true }] }),
  t("shuffle-lines", "Shuffle list", "Randomise the order of lines. Enter a seed to get the same shuffle again.", ["shuffle", "randomize", "random order", "draw names", "raffle"], "text.shuffleLines", "Shuffle", { options: [{ type: "text", key: "seed", label: "Seed (optional, repeatable)", default: "" }] }),
  t("rotate-list", "Rotate list", "Move the first N lines to the end (or the last N to the start).", ["rotate", "cycle", "shift list"], "text.rotateList", "RotateCw", { options: [{ type: "number", key: "by", label: "By", default: 1 }, { type: "select", key: "direction", label: "Direction", default: "up", options: [{ value: "up", label: "First to end" }, { value: "down", label: "Last to start" }] }] }),
  t("group-items", "Group list items", "Split a list into groups of N, into N groups round-robin, by first letter, or by a key before a separator.", ["group", "batch", "chunks", "teams", "by letter"], "text.groupItems", "Group", { options: [{ type: "select", key: "mode", label: "Group", default: "size", options: [{ value: "size", label: "Groups of N" }, { value: "count", label: "N groups (round robin)" }, { value: "letter", label: "By first letter" }, { value: "key", label: "By key before separator" }] }, { type: "number", key: "size", label: "N", default: 5, min: 1 }, { type: "text", key: "separator", label: "Key separator", default: ":" }] }),
  t("word-frequency", "Word & line frequency", "Most frequent words (or identical lines) with counts and share.", ["frequency", "most common", "popular", "count words", "duplicates count"], "text.wordFrequency", "ChartBar", { options: [{ type: "select", key: "mode", label: "Count", default: "words", options: [{ value: "words", label: "Words" }, { value: "lines", label: "Identical lines" }] }, { type: "number", key: "minLength", label: "Minimum length", default: 3, min: 1 }, { type: "number", key: "top", label: "Show top", default: 50, min: 1 }, { type: "checkbox", key: "caseSensitive", label: "Match case", default: false }] }),
  t("truncate-lines", "Truncate lines", "Cut every line to a maximum length with an ellipsis.", ["truncate", "shorten", "max length", "cut off"], "text.truncateLines", "Scissors", { options: [{ type: "number", key: "length", label: "Max characters", default: 80, min: 1 }, { type: "select", key: "side", label: "Keep", default: "end", options: [{ value: "end", label: "Start of line" }, { value: "start", label: "End of line" }] }, { type: "checkbox", key: "ellipsis", label: "Add …", default: true }] }),
  t("truncate-list", "Keep first / last N lines", "Keep only the first or last N items of a list.", ["first n", "last n", "head", "tail", "limit list"], "text.truncateList", "ListEnd", { options: [{ type: "number", key: "count", label: "N", default: 10, min: 0 }, { type: "select", key: "side", label: "Keep", default: "first", options: [{ value: "first", label: "First N" }, { value: "last", label: "Last N" }] }] }),
  t("randomize-case", "Randomize case", "RaNdOm or AlTeRnAtInG letter case.", ["random case", "alternating case", "mock text"], "text.randomizeCase", "CaseUpper", { options: [{ type: "select", key: "mode", label: "Mode", default: "random", options: [{ value: "random", label: "Random" }, { value: "alternate", label: "Alternating" }] }] }),
  t("slug-generator", "Slug generator", "Turn titles into URL- and file-name-safe slugs (accents removed, lower case, dashes).", ["slug", "url slug", "file name", "kebab", "safe name"], "text.slug", "Link2", { options: [{ type: "text", key: "separator", label: "Separator", default: "-" }, { type: "checkbox", key: "keepCase", label: "Keep letter case", default: false }, { type: "number", key: "maxLength", label: "Max length (0 = none)", default: 0, min: 0 }, { type: "checkbox", key: "perLine", label: "One slug per line", default: true }] }),
  t("text-to-table", "Text to table", "Detect columns in pasted text (tabs, commas, pipes or aligned spaces) and output Markdown, CSV, TSV, HTML or an ASCII table.", ["text to table", "markdown table", "ascii table", "align columns", "csv from text"], "text.textToTable", "Table", { options: [{ type: "select", key: "mode", label: "Columns separated by", default: "auto", options: [{ value: "auto", label: "Detect" }, { value: "tab", label: "Tab" }, { value: "comma", label: "Comma" }, { value: "pipe", label: "Pipe |" }, { value: "spaces", label: "2+ spaces" }, { value: "space", label: "Any space" }] }, { type: "select", key: "output", label: "Output", default: "markdown", options: [{ value: "markdown", label: "Markdown" }, { value: "csv", label: "CSV" }, { value: "tsv", label: "TSV" }, { value: "html", label: "HTML" }, { value: "ascii", label: "ASCII box" }] }] }),
  t("censor-words", "Censor words", "Mask chosen words with * (or any character), whole words only.", ["censor", "mask", "bleep", "redact words", "profanity"], "text.censor", "EyeOff", { options: [{ type: "text", key: "words", label: "Words to censor (comma separated)", default: "" }, { type: "text", key: "mask", label: "Mask character", default: "*" }, { type: "checkbox", key: "keepFirst", label: "Keep first letter", default: false }, { type: "checkbox", key: "caseSensitive", label: "Match case", default: false }] }),
  t("rot13", "ROT13 / Caesar shift", "Shift letters by N positions (13 = ROT13). Run again to decode.", ["rot13", "caesar", "cipher", "shift letters"], "text.rot13", "KeyRound", { options: [{ type: "number", key: "shift", label: "Shift", default: 13, min: 1, max: 25 }] })
];
