/**
 * Heuristic "AI-writing signals". This is NOT a detector that proves authorship:
 * fluent human writers trip these too, and edited AI text passes them. The score
 * is an aggregate of well-known statistical tells, reported transparently so a
 * reviewer can weigh them. Keep the wording honest in the UI.
 */
const STOCK_PHRASES = [
  "delve", "delves", "delving", "tapestry", "testament to", "in today's fast-paced", "it's important to note", "it is important to note", "in conclusion", "furthermore", "moreover", "additionally", "navigate the complexities", "unlock", "unleash", "game-changer", "cutting-edge", "robust", "seamless", "seamlessly", "leverage", "holistic", "in the realm of", "a myriad of", "plethora", "crucial", "pivotal", "vibrant", "embark", "journey", "landscape", "ever-evolving", "underscores", "fostering", "at the end of the day", "elevate", "comprehensive", "multifaceted", "paramount", "realm", "it's worth noting", "as an ai", "i hope this helps", "certainly!", "great question",
];

export interface Signal { name: string; verdict: "human-like" | "neutral" | "AI-like"; detail: string; weight: number }

const sentencesOf = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'(])/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 3);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const stdev = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

export function aiSignals(text: string) {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const sentences = sentencesOf(text);
  const lens = sentences.map((s) => s.split(/\s+/).length);
  const signals: Signal[] = [];

  // 1. Burstiness: humans vary sentence length more.
  const cv = lens.length > 3 ? stdev(lens) / Math.max(1, mean(lens)) : 0.5;
  signals.push({ name: "Sentence length variation", verdict: cv < 0.3 ? "AI-like" : cv > 0.5 ? "human-like" : "neutral", detail: `variation ${cv.toFixed(2)} (uniform text scores low)`, weight: 2 });

  // 2. Vocabulary richness (type-token ratio on a window).
  const window = words.slice(0, 300);
  const ttr = new Set(window).size / Math.max(1, window.length);
  signals.push({ name: "Vocabulary richness", verdict: ttr < 0.42 ? "AI-like" : ttr > 0.55 ? "human-like" : "neutral", detail: `${(ttr * 100).toFixed(0)}% unique words in the first 300`, weight: 1 });

  // 3. Stock phrases common in model output.
  const lower = text.toLowerCase();
  const hits = STOCK_PHRASES.filter((p) => lower.includes(p));
  const per1k = (hits.length / Math.max(1, words.length)) * 1000;
  signals.push({ name: "Stock phrases", verdict: per1k > 6 ? "AI-like" : per1k > 2.5 ? "neutral" : "human-like", detail: hits.length ? `${hits.length} found: ${hits.slice(0, 6).join(", ")}${hits.length > 6 ? "…" : ""}` : "none found", weight: 2 });

  // 4. Paragraph uniformity and tidy structure (every paragraph 3-5 sentences, lists of exactly three).
  const paras = text.split(/\n\s*\n/).map((p) => sentencesOf(p).length).filter((n) => n > 0);
  const pcv = paras.length > 2 ? stdev(paras) / Math.max(1, mean(paras)) : 0.6;
  signals.push({ name: "Paragraph uniformity", verdict: pcv < 0.25 && paras.length > 2 ? "AI-like" : "neutral", detail: `${paras.length} paragraphs, variation ${pcv.toFixed(2)}`, weight: 1 });

  // 5. Personal, concrete and informal markers (first person, numbers, contractions, typos) lean human.
  const personal = (lower.match(/\b(i|i'm|i've|we|my|our|honestly|frankly|yesterday|last week)\b/g) ?? []).length;
  const contractions = (lower.match(/\b\w+'(t|s|re|ve|ll|d|m)\b/g) ?? []).length;
  const numbers = (text.match(/\b\d[\d,.%$]*\b/g) ?? []).length;
  const concrete = (personal + contractions + numbers) / Math.max(1, words.length) * 1000;
  signals.push({ name: "Personal and concrete detail", verdict: concrete > 25 ? "human-like" : concrete < 8 ? "AI-like" : "neutral", detail: `${personal} personal, ${contractions} contractions, ${numbers} numbers per text`, weight: 2 });

  // 6. Hedged balanced closers ("In conclusion", "Overall,").
  const closers = (lower.match(/\b(in conclusion|in summary|overall,|to sum up|ultimately,)\b/g) ?? []).length;
  signals.push({ name: "Formulaic closers", verdict: closers >= 2 ? "AI-like" : closers === 1 ? "neutral" : "human-like", detail: `${closers} found`, weight: 1 });

  // 7. Em-dash / colon density (recent models over-use them).
  const dashes = (text.match(/[—–]|\s-\s/g) ?? []).length / Math.max(1, sentences.length);
  signals.push({ name: "Dash density", verdict: dashes > 0.5 ? "AI-like" : dashes < 0.15 ? "human-like" : "neutral", detail: `${dashes.toFixed(2)} per sentence`, weight: 1 });

  const total = signals.reduce((a, s) => a + s.weight, 0);
  const ai = signals.reduce((a, s) => a + (s.verdict === "AI-like" ? s.weight : s.verdict === "neutral" ? s.weight / 2 : 0), 0);
  const score = Math.round((ai / total) * 100);
  const label = score >= 70 ? "Likely AI-assisted" : score >= 45 ? "Mixed signals" : "Likely human-written";
  return {
    score,
    label,
    words: words.length,
    signals,
    note: "This is a statistical reading, not proof. Polished human writing can score high and lightly edited AI text can score low. Use it to decide where to look closer, not as a verdict.",
  };
}
