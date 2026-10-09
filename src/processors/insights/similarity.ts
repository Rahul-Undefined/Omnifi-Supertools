/** Text similarity: word-shingle overlap, Jaccard on vocabulary, and longest common word runs. */
const tokens = (t: string) => (t.toLowerCase().match(/[a-z0-9']+/g) ?? []);

function shingles(words: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function similarityReport(a: string, b: string) {
  const wa = tokens(a);
  const wb = tokens(b);
  const sa = shingles(wa, 5);
  const sb = shingles(wb, 5);
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  const shingleSim = sa.size && sb.size ? shared / Math.min(sa.size, sb.size) : 0;
  const va = new Set(wa);
  const vb = new Set(wb);
  let inter = 0;
  for (const w of va) if (vb.has(w)) inter++;
  const jaccard = va.size + vb.size - inter ? inter / (va.size + vb.size - inter) : 0;

  // Longest common runs via DP on word arrays (bounded to keep it quick).
  const A = wa.slice(0, 3000);
  const B = wb.slice(0, 3000);
  let best = { len: 0, i: 0 };
  const runs: { i: number; len: number }[] = [];
  let prev = new Uint16Array(B.length + 1);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Uint16Array(B.length + 1);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best.len) best = { len: cur[j], i: i - cur[j] };
        if (cur[j] >= 8 && (j === B.length || A[i] !== B[j])) runs.push({ i: i - cur[j], len: cur[j] });
      }
    }
    prev = cur;
  }
  // De-duplicate overlapping runs, keep the longest few.
  const passages: string[] = [];
  const seen = new Set<number>();
  for (const r of runs.sort((x, y) => y.len - x.len)) {
    if ([...seen].some((s) => Math.abs(s - r.i) < r.len)) continue;
    seen.add(r.i);
    passages.push(A.slice(r.i, r.i + r.len).join(" "));
    if (passages.length >= 5) break;
  }
  const overall = Math.round((shingleSim * 0.7 + jaccard * 0.3) * 100);
  return { overall, sharedShingles: shared, jaccard: Math.round(jaccard * 100), longest: { length: best.len, text: A.slice(best.i, best.i + best.len).join(" ") }, passages };
}
