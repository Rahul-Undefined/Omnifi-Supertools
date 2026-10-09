export interface RGB { r: number; g: number; b: number; a: number }

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1 };
  m = s.match(/^hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    return { r, g, b, a: m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1 };
  }
  return null;
}

export function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

export function colorFormats(c: RGB) {
  const hex = `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const lum = [c.r, c.g, c.b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  const luminance = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return {
    hex,
    hexAlpha: c.a < 1 ? `${hex}${Math.round(c.a * 255).toString(16).padStart(2, "0").toUpperCase()}` : hex,
    rgb: `rgb(${c.r}, ${c.g}, ${c.b})`,
    rgba: `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(2)})`,
    hsl: `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
    luminance: +luminance.toFixed(4),
    contrastOnWhite: +((1.05) / (luminance + 0.05)).toFixed(2),
    contrastOnBlack: +((luminance + 0.05) / 0.05).toFixed(2),
  };
}
