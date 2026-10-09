const MAJOR = ["SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "UNION ALL", "UNION", "WITH", "RETURNING"];
const JOINS = ["LEFT OUTER JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "CROSS JOIN", "JOIN"];
const MINOR = ["AND", "OR", "ON", "AS", "IN", "NOT", "NULL", "IS", "LIKE", "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT", "ASC", "DESC", "EXISTS", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST", "OVER", "PARTITION BY", "TRUE", "FALSE"];

/** Simple, predictable SQL formatter: major clauses on their own line, conditions indented. */
export function formatSql(sql: string, lower = false): string {
  // Protect string literals from keyword casing.
  const literals: string[] = [];
  let s = sql.replace(/'(?:[^'\\]|\\.)*'/g, (m) => {
    literals.push(m);
    return `\u0000${literals.length - 1}\u0000`;
  });
  s = s.replace(/\s+/g, " ").trim();
  const kw = (w: string) => (lower ? w.toLowerCase() : w.toUpperCase());
  for (const k of [...MAJOR, ...JOINS]) s = s.replace(new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`, "gi"), `\n${kw(k)}`);
  for (const k of MINOR) s = s.replace(new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`, "gi"), kw(k));
  s = s.replace(new RegExp(`\\s+(${kw("AND")}|${kw("OR")})\\s+`, "g"), "\n  $1 ");
  s = s.replace(/,\s*/g, ",\n  ");
  s = s.replace(/\(\s*\n?SELECT/gi, (m) => m.replace(/\s+/g, " "));
  s = s.replace(/\n{2,}/g, "\n").replace(/^\n/, "");
  // Re-indent lines following a major keyword's select list.
  const out = s
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/;\s*$/, ";");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => literals[Number(i)]);
}
