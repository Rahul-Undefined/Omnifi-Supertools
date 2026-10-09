import { ProcessorError } from "@/types/processor";

/** Base32 (RFC 4648), Base58 (Bitcoin alphabet), Base45 (RFC 9285) and Base16 codecs for UTF-8 text. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export type BaseKind = "base32" | "base58" | "base45" | "base16";

export function encodeBytes(kind: BaseKind, bytes: Uint8Array): string {
  switch (kind) {
    case "base16":
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    case "base32": {
      let bits = 0, value = 0, out = "";
      for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
      }
      if (bits > 0) out += B32[(value << (5 - bits)) & 31];
      while (out.length % 8) out += "=";
      return out;
    }
    case "base45": {
      let out = "";
      for (let i = 0; i < bytes.length; i += 2) {
        if (i + 1 < bytes.length) {
          let n = bytes[i] * 256 + bytes[i + 1];
          const c = n % 45; n = Math.floor(n / 45);
          const d = n % 45; const e = Math.floor(n / 45);
          out += B45[c] + B45[d] + B45[e];
        } else {
          const c = bytes[i] % 45; const d = Math.floor(bytes[i] / 45);
          out += B45[c] + B45[d];
        }
      }
      return out;
    }
    case "base58": {
      let zeros = 0;
      while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
      const digits: number[] = [];
      for (const b of bytes) {
        let carry = b;
        for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = Math.floor(carry / 58); }
        while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
      }
      return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
    }
  }
}

export function decodeToBytes(kind: BaseKind, text: string): Uint8Array {
  // Base45's alphabet includes the space character, so only line breaks are stripped there.
  const s = kind === "base45" ? text.replace(/[\r\n\t]+/g, "") : text.replace(/\s+/g, "");
  const bad = (what: string) => new ProcessorError(`Input is not valid ${what}`);
  switch (kind) {
    case "base16": {
      if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw bad("Base16 (hex)");
      return Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
    }
    case "base32": {
      const clean = s.toUpperCase().replace(/=+$/, "");
      if (!/^[A-Z2-7]*$/.test(clean)) throw bad("Base32");
      let bits = 0, value = 0;
      const out: number[] = [];
      for (const ch of clean) {
        value = (value << 5) | B32.indexOf(ch);
        bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
      }
      return Uint8Array.from(out);
    }
    case "base45": {
      if (s.length % 3 === 1 || [...s].some((c) => !B45.includes(c))) throw bad("Base45");
      const out: number[] = [];
      for (let i = 0; i < s.length; i += 3) {
        const c = B45.indexOf(s[i]), d = B45.indexOf(s[i + 1]);
        if (i + 2 < s.length) {
          const e = B45.indexOf(s[i + 2]);
          const n = c + d * 45 + e * 45 * 45;
          if (n > 65535) throw bad("Base45");
          out.push(n >> 8, n & 255);
        } else out.push(c + d * 45);
      }
      return Uint8Array.from(out);
    }
    case "base58": {
      if ([...s].some((c) => !B58.includes(c))) throw bad("Base58");
      let zeros = 0;
      while (zeros < s.length && s[zeros] === "1") zeros++;
      const bytes: number[] = [];
      for (const ch of s) {
        let carry = B58.indexOf(ch);
        for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 255; carry >>= 8; }
        while (carry > 0) { bytes.push(carry & 255); carry >>= 8; }
      }
      return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
    }
  }
}

export function encodeText(kind: BaseKind, text: string): string {
  return encodeBytes(kind, new TextEncoder().encode(text));
}

export function decodeText(kind: BaseKind, text: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decodeToBytes(kind, text));
  } catch (e) {
    if (e instanceof ProcessorError) throw e;
    throw new ProcessorError("Decoded bytes are not valid UTF-8 text", "The input may encode binary data rather than text.");
  }
}
