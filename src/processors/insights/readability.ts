/** Flesch readability, grade level, style counts and the Omnifi forbidden-word check. */
const FORBIDDEN = ["leverage", "synergy", "cutting-edge", "best-in-class", "holistic", "seamlessly", "innovative solutions", "dynamic", "robust", "bespoke", "end-to-end solution"];
const PASSIVE = /\b(am|is|are|was|were|be|been|being)\s+(\w+ed|\w+en|built|made|done|given|taken|seen|known|shown|held|sent|paid|kept|left|found)\b/gi;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function readabilityReport(text: string, brandVoice = true) {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const words = text.match(/[A-Za-z0-9'’-]+/g) ?? [];
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const W = Math.max(1, words.length);
  const S = Math.max(1, sentences.length);
  const fleschEase = Math.round(206.835 - 1.015 * (W / S) - 84.6 * (syl / W));
  const grade = Math.max(0, Math.round((0.39 * (W / S) + 11.8 * (syl / W) - 15.59) * 10) / 10);
  const easeLabel = fleschEase >= 70 ? "easy" : fleschEase >= 60 ? "plain English" : fleschEase >= 50 ? "fairly difficult" : fleschEase >= 30 ? "difficult" : "very difficult";
  const gradeLabel = grade <= 8 ? "general audience" : grade <= 12 ? "high school" : grade <= 16 ? "college" : "specialist";
  const lens = sentences.map((s) => (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length);
  const longSentences = lens.filter((l) => l >= 25).length;
  const passive = sentences.filter((s) => PASSIVE.test(s) && (PASSIVE.lastIndex = 0) === 0).length;
  const adverbs = (text.match(/\b\w+ly\b/g) ?? []).filter((w) => !/^(only|early|family|reply|apply|supply|likely|daily|weekly|monthly|yearly)$/i.test(w)).length;
  const lower = text.toLowerCase();
  const brandHits = brandVoice ? FORBIDDEN.map((word) => ({ word, count: (lower.match(new RegExp(`\\b${word.replace(/[-]/g, "\\-")}\\b`, "g")) ?? []).length })).filter((h) => h.count > 0) : [];
  const tips: string[] = [];
  if (W / S > 22) tips.push(`Average sentence is ${Math.round(W / S)} words; aim for under 20.`);
  if (longSentences) tips.push(`${longSentences} sentence${longSentences === 1 ? "" : "s"} run past 25 words; split them.`);
  if (passive > S * 0.2) tips.push("More than a fifth of sentences are passive; prefer active voice (\"We deliver X\").");
  if (adverbs > W / 40) tips.push("Many -ly adverbs; cut them or pick a stronger verb.");
  if (brandHits.length) tips.push("Replace the flagged words with plain, specific language.");
  const minutes = W / 220;
  return { fleschEase, easeLabel, grade, gradeLabel, avgSentence: Math.round(W / S), longSentences, passive, adverbs, brandHits, tips, readingTime: minutes < 1 ? `${Math.max(1, Math.round(minutes * 60))} sec` : `${Math.round(minutes)} min`, words: W, sentences: S };
}
