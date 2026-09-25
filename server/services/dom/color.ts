// Colour parsing and WCAG 2.x contrast math.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500",
  purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", navy: "#000080", teal: "#008080",
  lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", olive: "#808000", pink: "#ffc0cb",
  brown: "#a52a2a", gold: "#ffd700", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
  dimgray: "#696969", whitesmoke: "#f5f5f5", lightblue: "#add8e6", darkblue: "#00008b", darkred: "#8b0000", darkgreen: "#006400",
  crimson: "#dc143c", indigo: "#4b0082", violet: "#ee82ee", coral: "#ff7f50", salmon: "#fa8072", tomato: "#ff6347", ivory: "#fffff0",
  beige: "#f5f5dc", khaki: "#f0e68c", lavender: "#e6e6fa", tan: "#d2b48c", turquoise: "#40e0d0", slategray: "#708090",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parseChannel(s: string): number {
  const t = s.trim();
  return t.endsWith("%") ? clamp((parseFloat(t) / 100) * 255, 0, 255) : clamp(parseFloat(t), 0, 255);
}

function parseAlpha(s: string | undefined): number {
  if (s === undefined) return 1;
  const t = s.trim();
  const v = t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/** Returns null for values that are not a plain colour (currentcolor, inherit, gradients, unresolved var()). */
export function parseColor(input: string): Rgba | null {
  const v = input.trim().toLowerCase();
  if (!v) return null;
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[v]) return parseColor(NAMED[v]);
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(\s*([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    if (fn[1].startsWith("rgb")) {
      const rgb = { r: parseChannel(parts[0]), g: parseChannel(parts[1]), b: parseChannel(parts[2]), a: parseAlpha(parts[3]) };
      return [rgb.r, rgb.g, rgb.b, rgb.a].every(Number.isFinite) ? rgb : null;
    }
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return { r, g, b, a: parseAlpha(parts[3]) };
  }
  return null;
}

/** Composite `fg` over an opaque `bg`. */
export function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(c: Rgba): number {
  return 0.2126 * channelLum(c.r) + 0.7152 * channelLum(c.g) + 0.0722 * channelLum(c.b);
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function toHex(c: Rgba): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
