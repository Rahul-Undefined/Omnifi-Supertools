export type DiffOp = { type: "same" | "add" | "del"; text: string };

/** Line-level diff using LCS. Fine for documents up to a few thousand lines. */
export function diffLines(a: string, b: string): DiffOp[] {
  const A = a.split(/\r?\n/);
  const B = b.split(/\r?\n/);
  const n = A.length;
  const m = B.length;
  // Guard memory for very large inputs.
  if (n * m > 25_000_000) {
    return [
      ...A.map((text) => ({ type: "del" as const, text })),
      ...B.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i++] });
    } else {
      out.push({ type: "add", text: B[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}

export function formatDiff(ops: DiffOp[]): string {
  return ops.map((o) => (o.type === "same" ? "  " : o.type === "add" ? "+ " : "- ") + o.text).join("\n");
}

export function diffSummary(ops: DiffOp[]) {
  return {
    added: ops.filter((o) => o.type === "add").length,
    removed: ops.filter((o) => o.type === "del").length,
    unchanged: ops.filter((o) => o.type === "same").length,
  };
}
