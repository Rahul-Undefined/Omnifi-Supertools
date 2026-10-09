const COMMON = ["password", "123456", "12345678", "qwerty", "abc123", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "football", "princess", "login", "passw0rd", "omnifi", "summer", "winter", "spring", "autumn"];
const WORDS = "apple river stone cloud maple tiger candle forest silver copper harbor meadow falcon marble orchid pepper quartz saddle timber velvet walnut yonder zephyr amber basil cedar dune ember fjord glacier honey ivory jasper kelp lagoon mosaic nectar onyx pebble quill ripple sable thistle umber violet willow yarrow".split(" ");

export function passwordStrength(pw: string) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  let entropy = pw.length * Math.log2(Math.max(pool, 1));
  const warnings: string[] = [];
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) { warnings.push("Contains a very common password or word."); entropy *= 0.5; }
  if (/(.)\1{2,}/.test(pw)) { warnings.push("Repeated characters (aaa, 111)."); entropy *= 0.85; }
  if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) { warnings.push("Keyboard or number sequence."); entropy *= 0.7; }
  if (/^(19|20)\d{2}$|19\d{2}|20\d{2}/.test(pw)) warnings.push("Looks like it contains a year.");
  if (pw.length < 12) warnings.push("Shorter than 12 characters.");
  entropy = Math.round(entropy);
  // 1e10 guesses/second offline attack
  const seconds = Math.pow(2, entropy) / 1e10 / 2;
  const crackTime = seconds < 1 ? "instant" : seconds < 60 ? `${Math.round(seconds)} seconds` : seconds < 3600 ? `${Math.round(seconds / 60)} minutes` : seconds < 86400 ? `${Math.round(seconds / 3600)} hours` : seconds < 31536000 ? `${Math.round(seconds / 86400)} days` : seconds < 31536000 * 1000 ? `${Math.round(seconds / 31536000)} years` : seconds < 31536000 * 1e6 ? `${Math.round(seconds / 31536000 / 1000)} thousand years` : "centuries (effectively uncrackable)";
  const score = entropy < 28 ? 0 : entropy < 40 ? 1 : entropy < 60 ? 2 : entropy < 80 ? 3 : 4;
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score];
  return { entropy, score, label, crackTime, warnings };
}

function rand(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

export function generatePassword(length: number, o: { symbols: boolean; digits: boolean; passphrase: boolean }): string {
  if (o.passphrase) {
    const n = Math.max(4, Math.round(length / 6));
    const parts = Array.from({ length: n }, () => WORDS[rand(WORDS.length)]);
    parts[rand(n)] = parts[rand(n)].charAt(0).toUpperCase() + parts[rand(n)].slice(1);
    return parts.join("-") + (o.digits ? String(rand(90) + 10) : "") + (o.symbols ? "!?#$%&*"[rand(7)] : "");
  }
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ"];
  if (o.digits) sets.push("23456789");
  if (o.symbols) sets.push("!@#$%^&*-_=+?");
  const all = sets.join("");
  const out: string[] = sets.map((s) => s[rand(s.length)]);
  while (out.length < length) out.push(all[rand(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join("");
}
