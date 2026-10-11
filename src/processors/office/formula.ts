/**
 * Excel formula tokenizer, parser, explainer and checker.
 * Pure functions, no Excel engine: it explains structure and flags the
 * mistakes that cause most support questions (unbalanced brackets, wrong
 * argument counts, approximate-match lookups, hard-coded numbers, volatile
 * functions, missing error guards, deep IF nesting, whole-column references).
 */

export interface Token {
  type: "num" | "str" | "bool" | "err" | "ref" | "name" | "func" | "op" | "open" | "close" | "sep" | "space";
  value: string;
}

export type Node =
  | { kind: "num"; value: number; raw: string }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "err"; value: string }
  | { kind: "ref"; value: string }
  | { kind: "name"; value: string }
  | { kind: "func"; name: string; args: Node[] }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "unary"; op: string; operand: Node }
  | { kind: "group"; inner: Node }
  | { kind: "empty" };

export interface Issue {
  level: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

export interface FormulaAnalysis {
  formula: string;
  tokens: Token[];
  ast: Node | null;
  functions: string[];
  refs: string[];
  sheets: string[];
  constants: string[];
  issues: Issue[];
  depth: number; // max nesting of IF
  explanation: string[]; // indented lines
}

/* ---------- Function dictionary ---------- */

interface FnInfo {
  min: number;
  max: number; // Infinity for variadic
  what: string; // plain-English template, {1},{2}.. = args, {rest} = all args
  volatile?: boolean;
  category?: string;
}

export const FUNCTIONS: Record<string, FnInfo> = {
  SUM: { min: 1, max: Infinity, what: "add up {rest}" },
  SUMIF: { min: 2, max: 3, what: "add the values in {3|1} where {1} meets the condition {2}" },
  SUMIFS: { min: 3, max: Infinity, what: "add {1} for rows where all of these are true: {pairs2}" },
  SUMPRODUCT: { min: 1, max: Infinity, what: "multiply the arrays {rest} row by row and add up the results" },
  AVERAGE: { min: 1, max: Infinity, what: "take the average of {rest}" },
  AVERAGEIF: { min: 2, max: 3, what: "average the values in {3|1} where {1} meets {2}" },
  AVERAGEIFS: { min: 3, max: Infinity, what: "average {1} where all of these are true: {pairs2}" },
  COUNT: { min: 1, max: Infinity, what: "count how many numbers are in {rest}" },
  COUNTA: { min: 1, max: Infinity, what: "count how many non-empty cells are in {rest}" },
  COUNTBLANK: { min: 1, max: 1, what: "count the empty cells in {1}" },
  COUNTIF: { min: 2, max: 2, what: "count the cells in {1} that meet {2}" },
  COUNTIFS: { min: 2, max: Infinity, what: "count rows where all of these are true: {pairs1}" },
  MIN: { min: 1, max: Infinity, what: "find the smallest value in {rest}" },
  MAX: { min: 1, max: Infinity, what: "find the largest value in {rest}" },
  MINIFS: { min: 3, max: Infinity, what: "smallest value in {1} where {pairs2}" },
  MAXIFS: { min: 3, max: Infinity, what: "largest value in {1} where {pairs2}" },
  ROUND: { min: 2, max: 2, what: "round {1} to {2} decimal places" },
  ROUNDUP: { min: 2, max: 2, what: "round {1} up (away from zero) to {2} decimals" },
  ROUNDDOWN: { min: 2, max: 2, what: "round {1} down (towards zero) to {2} decimals" },
  INT: { min: 1, max: 1, what: "round {1} down to a whole number" },
  TRUNC: { min: 1, max: 2, what: "cut {1} off at {2|0} decimals without rounding" },
  MOD: { min: 2, max: 2, what: "the remainder after dividing {1} by {2}" },
  ABS: { min: 1, max: 1, what: "the absolute (positive) value of {1}" },
  SQRT: { min: 1, max: 1, what: "the square root of {1}" },
  POWER: { min: 2, max: 2, what: "{1} raised to the power {2}" },
  IF: { min: 2, max: 3, what: "if {1} is true then {2}, otherwise {3|FALSE}" },
  IFS: { min: 2, max: Infinity, what: "return the first result whose test is true: {pairs1}" },
  IFERROR: { min: 2, max: 2, what: "calculate {1}; if that gives an error show {2} instead" },
  IFNA: { min: 2, max: 2, what: "calculate {1}; if that is #N/A show {2} instead" },
  ISERROR: { min: 1, max: 1, what: "TRUE if {1} is any error" },
  ISNA: { min: 1, max: 1, what: "TRUE if {1} is #N/A" },
  ISBLANK: { min: 1, max: 1, what: "TRUE if {1} is empty" },
  ISNUMBER: { min: 1, max: 1, what: "TRUE if {1} is a number" },
  ISTEXT: { min: 1, max: 1, what: "TRUE if {1} is text" },
  AND: { min: 1, max: Infinity, what: "TRUE only if all of these are true: {rest}" },
  OR: { min: 1, max: Infinity, what: "TRUE if any of these is true: {rest}" },
  NOT: { min: 1, max: 1, what: "the opposite of {1}" },
  SWITCH: { min: 3, max: Infinity, what: "compare {1} against each value and return the matching result: {pairs2}" },
  CHOOSE: { min: 2, max: Infinity, what: "pick item number {1} from the list {rest2}" },
  VLOOKUP: { min: 3, max: 4, what: "look for {1} in the first column of {2} and return column {3} of that row ({match4})" },
  HLOOKUP: { min: 3, max: 4, what: "look for {1} in the first row of {2} and return row {3} ({match4})" },
  XLOOKUP: { min: 3, max: 6, what: "find {1} in {2} and return the matching value from {3}{xl4}" },
  LOOKUP: { min: 2, max: 3, what: "approximate lookup of {1} in {2} (requires sorted data)" },
  INDEX: { min: 2, max: 4, what: "the value in {1} at row {2}{idx3}" },
  MATCH: { min: 2, max: 3, what: "the position of {1} inside {2} ({match3m})" },
  XMATCH: { min: 2, max: 4, what: "the position of {1} inside {2}" },
  OFFSET: { min: 3, max: 5, what: "a range starting {2} rows and {3} columns away from {1}", volatile: true },
  INDIRECT: { min: 1, max: 2, what: "the cell or range whose address is the text {1}", volatile: true },
  ROW: { min: 0, max: 1, what: "the row number of {1|this cell}" },
  COLUMN: { min: 0, max: 1, what: "the column number of {1|this cell}" },
  ROWS: { min: 1, max: 1, what: "how many rows are in {1}" },
  COLUMNS: { min: 1, max: 1, what: "how many columns are in {1}" },
  FILTER: { min: 2, max: 3, what: "the rows of {1} where {2} is true{f3}" },
  UNIQUE: { min: 1, max: 3, what: "the distinct values in {1}" },
  SORT: { min: 1, max: 4, what: "{1} sorted" },
  SORTBY: { min: 2, max: Infinity, what: "{1} sorted by {2}" },
  SEQUENCE: { min: 1, max: 4, what: "a list of {1} numbers" },
  TRANSPOSE: { min: 1, max: 1, what: "{1} flipped from rows to columns" },
  LEFT: { min: 1, max: 2, what: "the first {2|1} character(s) of {1}" },
  RIGHT: { min: 1, max: 2, what: "the last {2|1} character(s) of {1}" },
  MID: { min: 3, max: 3, what: "{3} characters of {1} starting at position {2}" },
  LEN: { min: 1, max: 1, what: "the number of characters in {1}" },
  TRIM: { min: 1, max: 1, what: "{1} with extra spaces removed" },
  CLEAN: { min: 1, max: 1, what: "{1} with non-printable characters removed" },
  UPPER: { min: 1, max: 1, what: "{1} in capitals" },
  LOWER: { min: 1, max: 1, what: "{1} in lower case" },
  PROPER: { min: 1, max: 1, what: "{1} with Each Word Capitalised" },
  TEXT: { min: 2, max: 2, what: "{1} formatted as text using the pattern {2}" },
  VALUE: { min: 1, max: 1, what: "the text {1} turned into a number" },
  NUMBERVALUE: { min: 1, max: 3, what: "the text {1} turned into a number" },
  CONCAT: { min: 1, max: Infinity, what: "join together {rest}" },
  CONCATENATE: { min: 1, max: Infinity, what: "join together {rest}" },
  TEXTJOIN: { min: 3, max: Infinity, what: "join {rest3} with {1} between each item" },
  SUBSTITUTE: { min: 3, max: 4, what: "{1} with every {2} replaced by {3}" },
  REPLACE: { min: 4, max: 4, what: "{1} with {3} characters from position {2} replaced by {4}" },
  FIND: { min: 2, max: 3, what: "the position of {1} inside {2} (case-sensitive)" },
  SEARCH: { min: 2, max: 3, what: "the position of {1} inside {2} (ignores case)" },
  TEXTSPLIT: { min: 2, max: 6, what: "{1} split at every {2}" },
  TEXTBEFORE: { min: 2, max: 6, what: "the part of {1} before {2}" },
  TEXTAFTER: { min: 2, max: 6, what: "the part of {1} after {2}" },
  EXACT: { min: 2, max: 2, what: "TRUE if {1} and {2} are exactly the same text" },
  REPT: { min: 2, max: 2, what: "{1} repeated {2} times" },
  CHAR: { min: 1, max: 1, what: "the character with code {1}" },
  TODAY: { min: 0, max: 0, what: "today's date", volatile: true },
  NOW: { min: 0, max: 0, what: "the current date and time", volatile: true },
  RAND: { min: 0, max: 0, what: "a random number between 0 and 1", volatile: true },
  RANDBETWEEN: { min: 2, max: 2, what: "a random whole number between {1} and {2}", volatile: true },
  CELL: { min: 1, max: 2, what: "information ({1}) about {2|this cell}", volatile: true },
  INFO: { min: 1, max: 1, what: "system information {1}", volatile: true },
  DATE: { min: 3, max: 3, what: "the date made from year {1}, month {2}, day {3}" },
  DATEVALUE: { min: 1, max: 1, what: "the text {1} as a date" },
  YEAR: { min: 1, max: 1, what: "the year of {1}" },
  MONTH: { min: 1, max: 1, what: "the month number of {1}" },
  DAY: { min: 1, max: 1, what: "the day of the month of {1}" },
  WEEKDAY: { min: 1, max: 2, what: "the weekday number of {1}" },
  WEEKNUM: { min: 1, max: 2, what: "the week number of {1}" },
  EOMONTH: { min: 2, max: 2, what: "the last day of the month {2} months after {1}" },
  EDATE: { min: 2, max: 2, what: "the date {2} months after {1}" },
  DATEDIF: { min: 3, max: 3, what: "the difference between {1} and {2} in {3}" },
  DAYS: { min: 2, max: 2, what: "the number of days from {2} to {1}" },
  NETWORKDAYS: { min: 2, max: 3, what: "working days between {1} and {2}{hol3}" },
  "NETWORKDAYS.INTL": { min: 2, max: 4, what: "working days between {1} and {2} with a custom weekend" },
  WORKDAY: { min: 2, max: 3, what: "the working day {2} days after {1}{hol3}" },
  "WORKDAY.INTL": { min: 2, max: 4, what: "the working day {2} days after {1} with a custom weekend" },
  YEARFRAC: { min: 2, max: 3, what: "the fraction of a year between {1} and {2}" },
  PMT: { min: 3, max: 5, what: "the periodic payment for a loan at rate {1}, {2} periods, present value {3}" },
  IPMT: { min: 4, max: 6, what: "the interest part of payment {2}" },
  PPMT: { min: 4, max: 6, what: "the principal part of payment {2}" },
  PV: { min: 3, max: 5, what: "the present value at rate {1} over {2} periods of payment {3}" },
  FV: { min: 3, max: 5, what: "the future value at rate {1} over {2} periods of payment {3}" },
  NPV: { min: 2, max: Infinity, what: "the net present value at rate {1} of the cash flows {rest2}" },
  IRR: { min: 1, max: 2, what: "the internal rate of return of the cash flows {1}" },
  XNPV: { min: 3, max: 3, what: "net present value at rate {1} of cash flows {2} on dates {3}" },
  XIRR: { min: 2, max: 3, what: "internal rate of return of cash flows {1} on dates {2}" },
  RATE: { min: 3, max: 6, what: "the interest rate per period for {1} periods of payment {2} on {3}" },
  NPER: { min: 3, max: 5, what: "the number of periods at rate {1} with payment {2} on {3}" },
  SLN: { min: 3, max: 3, what: "straight-line depreciation of cost {1}, salvage {2} over {3} periods" },
  DB: { min: 4, max: 5, what: "declining-balance depreciation" },
  DDB: { min: 4, max: 5, what: "double-declining-balance depreciation" },
  LET: { min: 3, max: Infinity, what: "define names for intermediate values, then calculate the last argument" },
  LAMBDA: { min: 1, max: Infinity, what: "a custom function" },
  N: { min: 1, max: 1, what: "{1} as a number (text becomes 0)" },
  T: { min: 1, max: 1, what: "{1} if it is text, otherwise empty" },
  TYPE: { min: 1, max: 1, what: "the type code of {1}" },
  RANK: { min: 2, max: 3, what: "the rank of {1} within {2}" },
  "RANK.EQ": { min: 2, max: 3, what: "the rank of {1} within {2}" },
  LARGE: { min: 2, max: 2, what: "the {2}th largest value in {1}" },
  SMALL: { min: 2, max: 2, what: "the {2}th smallest value in {1}" },
  MEDIAN: { min: 1, max: Infinity, what: "the median of {rest}" },
  STDEV: { min: 1, max: Infinity, what: "the standard deviation of {rest}" },
  "STDEV.S": { min: 1, max: Infinity, what: "the sample standard deviation of {rest}" },
  "STDEV.P": { min: 1, max: Infinity, what: "the population standard deviation of {rest}" },
  VAR: { min: 1, max: Infinity, what: "the variance of {rest}" },
  PERCENTILE: { min: 2, max: 2, what: "the {2} percentile of {1}" },
  SUBTOTAL: { min: 2, max: Infinity, what: "subtotal (function code {1}) of {rest2}, ignoring other subtotals" },
  AGGREGATE: { min: 3, max: Infinity, what: "aggregate (function code {1}, options {2}) of {rest3}" },
  GETPIVOTDATA: { min: 2, max: Infinity, what: "a value from the pivot table at {2}" },
  HYPERLINK: { min: 1, max: 2, what: "a clickable link to {1}" },
  FORMULATEXT: { min: 1, max: 1, what: "the formula in {1} as text" },
  ADDRESS: { min: 2, max: 5, what: "the cell address for row {1}, column {2}" },
  IMAGE: { min: 1, max: 5, what: "an image from {1}" },
};

export const VOLATILE = new Set(Object.entries(FUNCTIONS).filter(([, f]) => f.volatile).map(([k]) => k));

/* ---------- Tokenizer ---------- */

const REF_RE = /^(?:(?:'(?:[^']|'')+'|[A-Za-z0-9_.]+)!)?(?:\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d{1,7}:\$?\d{1,7})(?![A-Za-z0-9_(])/;
const EXT_REF_RE = /^(?:'[^']*\[[^\]]+\][^']*'|\[[^\]]+\][A-Za-z0-9_.]+)!(?:\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})/;
const STRUCT_RE = /^[A-Za-z_][A-Za-z0-9_.]*\[(?:\[[^\]]*\]|[^\]])*\]/; // Table1[Column]
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?/;
const ERR_RE = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/i;
const NAME_RE = /^[A-Za-z_\\][A-Za-z0-9_.\\]*/;

export function tokenize(src: string): { tokens: Token[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const tokens: Token[] = [];
  let s = src.trim();
  if (s.startsWith("=")) s = s.slice(1);
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const c = rest[0];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = 1; let closed = false; let val = "";
      while (j < rest.length) {
        if (rest[j] === '"') { if (rest[j + 1] === '"') { val += '"'; j += 2; continue; } closed = true; j++; break; }
        val += rest[j]; j++;
      }
      if (!closed) issues.push({ level: "error", message: `Text starting at ${rest.slice(0, 12)}… is never closed`, fix: 'Add the missing closing quote ("). To put a quote inside text, double it: "".' });
      tokens.push({ type: "str", value: val }); i += j; continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = rest.match(ERR_RE))) { tokens.push({ type: "err", value: m[0].toUpperCase() }); i += m[0].length; continue; }
    if ((m = rest.match(EXT_REF_RE)) || (m = rest.match(REF_RE)) || (m = rest.match(STRUCT_RE))) { tokens.push({ type: "ref", value: m[0] }); i += m[0].length; continue; }
    if ((m = rest.match(NUM_RE)) && /\d/.test(m[0])) { tokens.push({ type: "num", value: m[0] }); i += m[0].length; continue; }
    if ((m = rest.match(/^(?:TRUE|FALSE)(?![A-Za-z0-9_])/i))) { tokens.push({ type: "bool", value: m[0].toUpperCase() }); i += m[0].length; continue; }
    if ((m = rest.match(NAME_RE))) {
      const after = rest.slice(m[0].length).match(/^\s*\(/);
      if (after) { tokens.push({ type: "func", value: m[0].toUpperCase().replace(/^_XLFN\./, "") }); i += m[0].length + after[0].length; tokens.push({ type: "open", value: "(" }); continue; }
      tokens.push({ type: "name", value: m[0] }); i += m[0].length; continue;
    }
    if (c === "(") { tokens.push({ type: "open", value: "(" }); i++; continue; }
    if (c === ")") { tokens.push({ type: "close", value: ")" }); i++; continue; }
    if (c === "," || c === ";") { tokens.push({ type: "sep", value: c }); i++; continue; }
    if ((m = rest.match(/^(?:<=|>=|<>|[-+*/^&=<>:@#])/))) { tokens.push({ type: "op", value: m[0] }); i += m[0].length; continue; }
    if (c === "{") { const j = rest.indexOf("}"); if (j > 0) { tokens.push({ type: "name", value: rest.slice(0, j + 1) }); i += j + 1; continue; } }
    issues.push({ level: "error", message: `Unexpected character "${c}" at position ${i + 1}` });
    i++;
  }
  return { tokens, issues };
}

/* ---------- Parser (precedence climbing) ---------- */

const PREC: Record<string, number> = { ":": 8, "@": 7, "#": 7, "^": 6, "*": 5, "/": 5, "+": 4, "-": 4, "&": 3, "=": 2, "<": 2, ">": 2, "<=": 2, ">=": 2, "<>": 2 };

export function parse(tokens: Token[]): { ast: Node | null; issues: Issue[] } {
  const issues: Issue[] = [];
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  function primary(): Node {
    const t = peek();
    if (!t) { issues.push({ level: "error", message: "Formula ends too early: something is missing at the end", fix: "Check for a trailing operator such as + or & with nothing after it." }); return { kind: "empty" }; }
    if (t.type === "num") { next(); const v = t.value.endsWith("%") ? Number(t.value.slice(0, -1)) / 100 : Number(t.value); return { kind: "num", value: v, raw: t.value }; }
    if (t.type === "str") { next(); return { kind: "str", value: t.value }; }
    if (t.type === "bool") { next(); return { kind: "bool", value: t.value === "TRUE" }; }
    if (t.type === "err") { next(); return { kind: "err", value: t.value }; }
    if (t.type === "ref") { next(); return { kind: "ref", value: t.value }; }
    if (t.type === "name") { next(); return { kind: "name", value: t.value }; }
    if (t.type === "func") {
      next(); next(); // name + open
      const args: Node[] = [];
      if (peek()?.type === "close") { next(); return { kind: "func", name: t.value, args }; }
      for (;;) {
        if (peek()?.type === "sep" || peek()?.type === "close" || !peek()) args.push({ kind: "empty" });
        else args.push(expr(0));
        const n = peek();
        if (!n) { issues.push({ level: "error", message: `${t.value}( is never closed`, fix: "Add the missing closing bracket )." }); break; }
        if (n.type === "sep") { next(); continue; }
        if (n.type === "close") { next(); break; }
        issues.push({ level: "error", message: `Unexpected "${n.value}" inside ${t.value}(…)`, fix: "Arguments must be separated by commas." });
        next();
      }
      return { kind: "func", name: t.value, args };
    }
    if (t.type === "open") {
      next();
      const inner = expr(0);
      if (peek()?.type === "close") next();
      else issues.push({ level: "error", message: "An opening bracket ( has no matching )", fix: "Count the brackets: every ( needs a )." });
      return { kind: "group", inner };
    }
    if (t.type === "op" && (t.value === "-" || t.value === "+")) { next(); return { kind: "unary", op: t.value, operand: primary() }; }
    if (t.type === "close") { issues.push({ level: "error", message: "A closing bracket ) has no matching (", fix: "Remove the extra ) or add a ( earlier." }); next(); return { kind: "empty" }; }
    if (t.type === "sep") { issues.push({ level: "error", message: "A comma appears outside any function", fix: "Commas only separate function arguments." }); next(); return { kind: "empty" }; }
    issues.push({ level: "error", message: `Unexpected "${t.value}"` });
    next();
    return { kind: "empty" };
  }

  function expr(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.type !== "op") break;
      const pr = PREC[t.value];
      if (pr === undefined || pr < minPrec) break;
      next();
      if (t.value === "%") { left = { kind: "binary", op: "/", left, right: { kind: "num", value: 100, raw: "100" } }; continue; }
      const nextTok = peek();
      if (!nextTok || nextTok.type === "close" || nextTok.type === "sep") {
        issues.push({ level: "error", message: `Operator "${t.value}" has nothing after it`, fix: "Add the missing value or remove the operator." });
        return { kind: "binary", op: t.value, left, right: { kind: "empty" } };
      }
      if (nextTok.type === "op" && !["-", "+"].includes(nextTok.value)) {
        issues.push({ level: "error", message: `Two operators in a row: "${t.value}${nextTok.value}"`, fix: "Remove one of them." });
      }
      const right = expr(pr + 1);
      left = { kind: "binary", op: t.value, left, right };
    }
    return left;
  }

  if (!tokens.length) return { ast: null, issues: [{ level: "error", message: "The formula is empty" }] };
  const ast = expr(0);
  if (p < tokens.length) {
    const t = tokens[p];
    if (t.type === "close") issues.push({ level: "error", message: "There is an extra closing bracket )", fix: "Remove it, or add the matching ( earlier." });
    else issues.push({ level: "error", message: `Unexpected "${t.value}" after the end of the expression` });
  }
  return { ast, issues };
}

/* ---------- Analysis ---------- */

function walk(n: Node, fn: (n: Node, depthIf: number) => void, depthIf = 0) {
  fn(n, depthIf);
  switch (n.kind) {
    case "func": n.args.forEach((a) => walk(a, fn, depthIf + (n.name === "IF" ? 1 : 0))); break;
    case "binary": walk(n.left, fn, depthIf); walk(n.right, fn, depthIf); break;
    case "unary": walk(n.operand, fn, depthIf); break;
    case "group": walk(n.inner, fn, depthIf); break;
  }
}

export function toText(n: Node): string {
  switch (n.kind) {
    case "num": return n.raw;
    case "str": return `"${n.value.replace(/"/g, '""')}"`;
    case "bool": return n.value ? "TRUE" : "FALSE";
    case "err": return n.value;
    case "ref": return n.value;
    case "name": return n.value;
    case "func": return `${n.name}(${n.args.map(toText).join(", ")})`;
    case "binary": return `${toText(n.left)} ${n.op} ${toText(n.right)}`;
    case "unary": return `${n.op}${toText(n.operand)}`;
    case "group": return `(${toText(n.inner)})`;
    case "empty": return "";
  }
}

const OP_WORDS: Record<string, string> = { "+": "plus", "-": "minus", "*": "times", "/": "divided by", "^": "to the power of", "&": "joined with", "=": "equals", "<>": "is not equal to", "<": "is less than", ">": "is greater than", "<=": "is at most", ">=": "is at least", ":": "through" };

function short(n: Node): string {
  switch (n.kind) {
    case "num": return n.raw;
    case "str": return `"${n.value}"`;
    case "bool": return n.value ? "TRUE" : "FALSE";
    case "err": return n.value;
    case "ref": return n.value;
    case "name": return n.value;
    case "empty": return "(nothing)";
    case "func": return `${n.name}(…)`;
    case "group": return short(n.inner);
    case "unary": return `${n.op}${short(n.operand)}`;
    case "binary": return `${short(n.left)} ${OP_WORDS[n.op] ?? n.op} ${short(n.right)}`;
  }
}

function fill(template: string, args: Node[]): string {
  const a = (i: number) => (args[i - 1] && args[i - 1].kind !== "empty" ? short(args[i - 1]) : "");
  return template
    .replace(/\{(\d+)\|([^}]*)\}/g, (_, i, d) => a(Number(i)) || d)
    .replace(/\{rest(\d*)\}/g, (_, from) => args.slice(from ? Number(from) - 1 : 0).map(short).join(", "))
    .replace(/\{pairs(\d)\}/g, (_, from) => { const out: string[] = []; for (let i = Number(from) - 1; i < args.length; i += 2) out.push(`${short(args[i])} → ${args[i + 1] ? short(args[i + 1]) : "?"}`); return out.join("; "); })
    .replace(/\{match4\}/g, () => { const m = args[3]; if (!m || m.kind === "empty") return "APPROXIMATE match because the 4th argument is missing"; if ((m.kind === "bool" && !m.value) || (m.kind === "num" && m.value === 0)) return "exact match"; return "approximate match: needs sorted data"; })
    .replace(/\{match3m\}/g, () => { const m = args[2]; if (!m || m.kind === "empty") return "approximate match (1): sorted ascending"; if (m.kind === "num" && m.value === 0) return "exact match"; if (m.kind === "num" && m.value === -1) return "approximate match: sorted descending"; return "match type " + short(m); })
    .replace(/\{xl4\}/g, () => (args[3] && args[3].kind !== "empty" ? `, showing ${short(args[3])} if not found` : ""))
    .replace(/\{idx3\}/g, () => (args[2] && args[2].kind !== "empty" ? `, column ${short(args[2])}` : ""))
    .replace(/\{f3\}/g, () => (args[2] && args[2].kind !== "empty" ? `, or ${short(args[2])} if nothing matches` : ""))
    .replace(/\{hol3\}/g, () => (args[2] && args[2].kind !== "empty" ? `, skipping the holidays in ${short(args[2])}` : ""))
    .replace(/\{(\d+)\}/g, (_, i) => a(Number(i)) || "(missing)");
}

function explain(n: Node, lines: string[], indent = 0) {
  const pad = "  ".repeat(indent);
  switch (n.kind) {
    case "func": {
      const info = FUNCTIONS[n.name];
      lines.push(`${pad}${n.name}: ${info ? fill(info.what, n.args) : `call the function ${n.name} with ${n.args.length} argument(s)`}`);
      n.args.forEach((a, i) => { if (a.kind === "func" || a.kind === "binary") { lines.push(`${pad}  argument ${i + 1}:`); explain(a, lines, indent + 2); } });
      break;
    }
    case "binary": {
      lines.push(`${pad}${short(n.left)} ${OP_WORDS[n.op] ?? n.op} ${short(n.right)}`);
      if (n.left.kind === "func" || n.left.kind === "binary") explain(n.left, lines, indent + 1);
      if (n.right.kind === "func" || n.right.kind === "binary") explain(n.right, lines, indent + 1);
      break;
    }
    case "group": explain(n.inner, lines, indent); break;
    case "unary": lines.push(`${pad}negative of ${short(n.operand)}`); if (n.operand.kind === "func") explain(n.operand, lines, indent + 1); break;
    default: lines.push(`${pad}the value ${short(n)}`);
  }
}

export function analyzeFormula(formula: string): FormulaAnalysis {
  const { tokens, issues: tokIssues } = tokenize(formula);
  const { ast, issues: parseIssues } = parse(tokens);
  const issues = [...tokIssues, ...parseIssues];
  const functions: string[] = [];
  const refs: string[] = [];
  const sheets = new Set<string>();
  const constants: string[] = [];
  let depth = 0;
  const opens = tokens.filter((t) => t.type === "open").length;
  const closes = tokens.filter((t) => t.type === "close").length;
  if (opens !== closes && !issues.some((i) => /bracket/.test(i.message))) issues.push({ level: "error", message: `${opens} opening bracket(s) but ${closes} closing`, fix: "Balance the brackets." });
  if (tokens.some((t) => t.type === "sep" && t.value === ";") && tokens.some((t) => t.type === "sep" && t.value === ",")) issues.push({ level: "warning", message: "Mixed , and ; separators", fix: "Use the separator your Excel locale expects (comma in US English)." });

  if (ast) {
    walk(ast, (n, d) => {
      if (n.kind === "func") {
        functions.push(n.name);
        if (n.name === "IF") depth = Math.max(depth, d + 1);
        const info = FUNCTIONS[n.name];
        if (!info) {
          if (!/^(?:_XLWS\.|_xlfn\.)/i.test(n.name) && !/^[A-Z]+\.[A-Z]+/.test(n.name)) issues.push({ level: "warning", message: `${n.name} is not a function I recognise`, fix: "Check the spelling. A typo here shows up as #NAME? in Excel." });
        } else {
          const given = n.args.filter((a) => a.kind !== "empty").length;
          const total = n.args.length;
          if (total < info.min) issues.push({ level: "error", message: `${n.name} needs at least ${info.min} argument(s) but has ${total}`, fix: `Usage: ${n.name}(${sig(n.name)})` });
          else if (total > info.max) issues.push({ level: "error", message: `${n.name} accepts at most ${info.max} argument(s) but has ${total}`, fix: `Usage: ${n.name}(${sig(n.name)})` });
          else if (given < total && !["IF", "INDEX", "LET", "FILTER", "XLOOKUP", "OFFSET", "MATCH", "SUMIF", "AVERAGEIF", "TRUNC", "ROW", "COLUMN"].includes(n.name)) issues.push({ level: "warning", message: `${n.name} has an empty argument`, fix: "Check for a double comma ,, inside the brackets." });
        }
        if (VOLATILE.has(n.name)) issues.push({ level: "info", message: `${n.name} is volatile: it recalculates on every change and slows big workbooks`, fix: n.name === "INDIRECT" || n.name === "OFFSET" ? "Prefer INDEX or structured references where possible." : undefined });
        if ((n.name === "VLOOKUP" || n.name === "HLOOKUP")) {
          const m = n.args[3];
          if (!m || m.kind === "empty") issues.push({ level: "warning", message: `${n.name} without the 4th argument uses APPROXIMATE match`, fix: "Add FALSE (or 0) as the last argument for an exact match: wrong answers on unsorted data otherwise." });
          const tbl = n.args[1];
          if (tbl && tbl.kind === "ref" && !tbl.value.includes("$") && !/\[/.test(tbl.value) && /\d/.test(tbl.value)) issues.push({ level: "warning", message: `The lookup table ${tbl.value} has no $ signs`, fix: `Use ${absolutize(tbl.value)} so the table stays fixed when the formula is copied down.` });
          const col = n.args[2];
          if (col && col.kind === "num") issues.push({ level: "info", message: `Column number ${col.raw} is hard-coded`, fix: "Inserting a column into the table will silently break it. MATCH() or XLOOKUP avoids this." });
        }
        if (n.name === "MATCH" && (!n.args[2] || n.args[2].kind === "empty")) issues.push({ level: "warning", message: "MATCH without a match type uses approximate match (1)", fix: "Add 0 as the 3rd argument for an exact match." });
        if ((n.name === "SUMIF" || n.name === "COUNTIF" || n.name === "AVERAGEIF") && n.args[1]?.kind === "ref" && n.args[0]?.kind === "ref" && n.args[0].value.includes(":") && !n.args[1].value.includes(":")) { /* fine */ }
        if ((n.name === "SUMIFS" || n.name === "COUNTIFS" || n.name === "AVERAGEIFS" || n.name === "MAXIFS" || n.name === "MINIFS")) {
          const start = n.name === "COUNTIFS" ? 0 : 1;
          if ((n.args.length - start) % 2 !== 0) issues.push({ level: "error", message: `${n.name} arguments must come in range/criteria pairs`, fix: "Each criteria range needs a criterion after it." });
        }
        if (n.name === "IFERROR" && n.args[0]?.kind === "ref") issues.push({ level: "info", message: "IFERROR wraps a plain cell reference, which hides real errors from that cell" });
        if (n.name === "SUM" && n.args.length === 1 && n.args[0].kind === "num") issues.push({ level: "info", message: "SUM of a single number does nothing" });
        if ((n.name === "SUM" || n.name === "AVERAGE" || n.name === "COUNT") && n.args.some((a) => a.kind === "ref" && /^\$?[A-Z]{1,3}:\$?[A-Z]{1,3}$/i.test(a.value))) issues.push({ level: "info", message: "Whole-column reference (e.g. A:A) is fine for SUM but slow inside SUMPRODUCT or array formulas" });
        if (n.name === "SUMPRODUCT" && n.args.some((a) => a.kind === "ref" && /^\$?[A-Z]{1,3}:\$?[A-Z]{1,3}$/i.test(a.value))) issues.push({ level: "warning", message: "SUMPRODUCT over whole columns processes a million rows every recalculation", fix: "Limit the range (A2:A5000) or use a Table column." });
        if (n.name === "LOOKUP") issues.push({ level: "info", message: "LOOKUP always uses approximate match and needs sorted data; XLOOKUP or INDEX/MATCH is safer" });
        if (n.name === "DATEDIF") issues.push({ level: "info", message: "DATEDIF is undocumented in Excel and has a known bug with the \"MD\" unit" });
        if (n.name === "CONCATENATE") issues.push({ level: "info", message: "CONCATENATE is legacy; CONCAT or TEXTJOIN handle ranges" });
        if (n.name === "RANK") issues.push({ level: "info", message: "RANK is legacy; RANK.EQ is the current name" });
      }
      if (n.kind === "ref") {
        refs.push(n.value);
        const m = n.value.match(/^(?:'((?:[^']|'')+)'|([A-Za-z0-9_.[\]]+))!/);
        if (m) sheets.add((m[1] ?? m[2]).replace(/''/g, "'"));
        if (/\[.*\]/.test(n.value) && /!/.test(n.value)) issues.push({ level: "warning", message: `${n.value} points to another workbook`, fix: "External links break when the other file moves or is closed. Consider pasting values or Power Query." });
      }
      if (n.kind === "err") issues.push({ level: "error", message: `The formula contains ${n.value}`, fix: n.value === "#REF!" ? "A referenced cell, row or sheet was deleted. Rebuild that reference." : "This error literal makes the whole formula fail." });
      if (n.kind === "num" && n.value !== 0 && n.value !== 1 && n.value !== 100 && n.value !== 2 && !Number.isInteger(n.value * 1) ) constants.push(n.raw);
      if (n.kind === "num" && Number.isInteger(n.value) && Math.abs(n.value) >= 1000) constants.push(n.raw);
      if (n.kind === "binary" && n.op === "/" ) {
        const r = n.right;
        if (r.kind === "num" && r.value === 0) issues.push({ level: "error", message: "Division by zero", fix: "The divisor is a literal 0." });
      }
      if (n.kind === "binary" && ["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
        const [l, r] = [n.left, n.right];
        if ((l.kind === "str" && r.kind === "num") || (l.kind === "num" && r.kind === "str")) issues.push({ level: "warning", message: `Comparing text with a number (${short(n)}) is never equal`, fix: "Compare like with like: \"10\" is text, 10 is a number. Use VALUE() or remove the quotes." });
        if (r.kind === "str" && /^\d+(\.\d+)?$/.test(r.value)) issues.push({ level: "warning", message: `"${r.value}" is text, not a number`, fix: `Write ${r.value} without quotes.` });
      }
      if (n.kind === "binary" && n.op === "&" && (n.left.kind === "num" || n.right.kind === "num")) issues.push({ level: "info", message: "Joining a number with & produces text; the result cannot be summed" });
      if (n.kind === "name" && !/^\{/.test(n.value) && !/^(?:TRUE|FALSE)$/i.test(n.value)) issues.push({ level: "info", message: `${n.value} is treated as a named range or table`, fix: "If it is not defined in the workbook Excel shows #NAME?." });
    });
  }

  if (depth >= 3) issues.push({ level: "warning", message: `${depth} levels of nested IF`, fix: "IFS(), SWITCH() or a lookup table is far easier to read and maintain." });
  const divisions: Extract<Node, { kind: "binary" }>[] = [];
  if (ast) walk(ast, (n) => { if (n.kind === "binary" && n.op === "/" && !(n.right.kind === "num")) divisions.push(n); });
  const guarded = functions.includes("IFERROR") || functions.includes("IF") || functions.includes("IFNA");
  if (divisions.length && !guarded) issues.push({ level: "info", message: `Division by ${short(divisions[0].right)} has no guard`, fix: "Wrap in IFERROR(…, 0) or IF(divisor=0, 0, …) to avoid #DIV/0!." });
  const uniqConst = [...new Set(constants)];
  if (uniqConst.length) issues.push({ level: "info", message: `Hard-coded number(s): ${uniqConst.slice(0, 5).join(", ")}`, fix: "Put rates and thresholds in a labelled input cell and reference it, so they are visible and easy to change." });
  if (!issues.some((i) => i.level === "error") && ast && tokens.length && !formula.trim().startsWith("=")) issues.push({ level: "info", message: "No leading = sign; Excel would treat this as text" });

  const explanation: string[] = [];
  if (ast) explain(ast, explanation);
  return { formula, tokens, ast, functions: [...new Set(functions)], refs: [...new Set(refs)], sheets: [...sheets], constants: uniqConst, issues: dedupeIssues(issues), depth, explanation };
}

function dedupeIssues(list: Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => { const k = i.level + i.message; if (seen.has(k)) return false; seen.add(k); return true; });
}

function sig(name: string): string {
  const samples: Record<string, string> = {
    VLOOKUP: "lookup_value, table, column_number, FALSE", HLOOKUP: "lookup_value, table, row_number, FALSE", XLOOKUP: "lookup_value, lookup_array, return_array, [if_not_found]",
    IF: "test, value_if_true, [value_if_false]", IFERROR: "value, value_if_error", SUMIF: "range, criteria, [sum_range]", SUMIFS: "sum_range, criteria_range1, criteria1, …",
    COUNTIF: "range, criteria", INDEX: "array, row, [column]", MATCH: "value, array, 0", ROUND: "number, decimals", TEXT: "value, \"format\"", MID: "text, start, length",
    PMT: "rate, nper, pv", DATE: "year, month, day", EOMONTH: "start_date, months", NETWORKDAYS: "start, end, [holidays]",
  };
  if (samples[name]) return samples[name];
  const f = FUNCTIONS[name];
  if (!f) return "…";
  const n = f.max === Infinity ? Math.max(f.min, 2) : f.max;
  return Array.from({ length: n }, (_, i) => (i < f.min ? `arg${i + 1}` : `[arg${i + 1}]`)).join(", ") + (f.max === Infinity ? ", …" : "");
}

export function absolutize(ref: string): string {
  return ref.replace(/(?<![$A-Za-z])([A-Za-z]{1,3})(?![A-Za-z])/g, "$$$1").replace(/(?<![$\d])(\d+)/g, "$$$1");
}

/** Convert A1-style references to a position-relative form so copied formulas compare equal. */
export function relativeForm(formula: string, row: number, col: number): string {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, cAbs, cLet, rAbs, rNum) => {
    const c = colToNum(cLet);
    const r = Number(rNum);
    if (!c || !r) return m;
    return `${cAbs ? `C$${c}` : `C[${c - col}]`}${rAbs ? `R$${r}` : `R[${r - row}]`}`;
  });
}

export function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Render an analysis as plain text for the result panel. */
export function formatAnalysis(a: FormulaAnalysis): string {
  const out: string[] = [];
  out.push(`Formula: ${a.formula.trim().startsWith("=") ? a.formula.trim() : "=" + a.formula.trim()}`);
  out.push("");
  const errors = a.issues.filter((i) => i.level === "error");
  const warnings = a.issues.filter((i) => i.level === "warning");
  const infos = a.issues.filter((i) => i.level === "info");
  out.push(errors.length ? `STATUS: ${errors.length} problem(s) that will stop this formula working` : warnings.length ? `STATUS: valid, with ${warnings.length} thing(s) worth fixing` : "STATUS: looks good");
  out.push("");
  if (a.explanation.length) { out.push("WHAT IT DOES"); for (const l of a.explanation) out.push("  " + l); out.push(""); }
  const section = (title: string, list: Issue[]) => { if (!list.length) return; out.push(title); for (const i of list) { out.push(`  • ${i.message}`); if (i.fix) out.push(`      fix: ${i.fix}`); } out.push(""); };
  section("ERRORS", errors);
  section("WARNINGS", warnings);
  section("NOTES", infos);
  if (a.functions.length) out.push(`Functions used: ${a.functions.join(", ")}`);
  if (a.refs.length) out.push(`Cells and ranges: ${a.refs.join(", ")}`);
  if (a.sheets.length) out.push(`Other sheets: ${a.sheets.join(", ")}`);
  return out.join("\n").trim();
}
