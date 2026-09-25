import { blend, parseColor, Rgba } from "./color";
import { isStateful, matchesSelector, parseDecls, splitTopLevel } from "./css";
import { CssRule, PageModel, classList } from "./model";

export interface ComputedStyle {
  color: Rgba;
  fontSizePx: number;
  bold: boolean;
  lineHeightPx: number;
  lineHeightRaw: string;
  display: string;
  position: string;
  opacity: number;
  width: number | null;
  height: number | null;
  minWidth: number | null;
  minHeight: number | null;
  padding: { t: number; r: number; b: number; l: number };
}

const UA_FONT_SCALE: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67, small: 0.83, sub: 0.83, sup: 0.83, big: 1.2 };
const UA_BOLD = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "th"]);
const FONT_KEYWORDS: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };
const SHORTHANDS = new Set(["padding", "margin", "background", "outline", "font"]);

/** Length to px. `em` resolves against `emBase`. Returns null for %, auto, calc(), viewport units etc. */
export function lengthToPx(value: string | undefined, emBase: number): number | null {
  if (!value) return null;
  const m = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "rem": return n * 16;
    case "em": return n * emBase;
    case "pt": return (n * 4) / 3;
    default: return n;
  }
}

export function resolveVars(value: string, vars: Map<string, string>): string {
  let out = value;
  for (let i = 0; i < 8 && out.includes("var("); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_m, name: string, fallback: string | undefined) => vars.get(name) ?? fallback ?? "");
  }
  return out.trim();
}

function boxValues(value: string): [string, string, string, string] {
  const v = splitTopLevel(value, " ");
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  return [v[0], v[1], v[2], v[3] ?? v[1]];
}

function expandShorthand(name: string, value: string, out: Map<string, string>): void {
  const tokens = splitTopLevel(value, " ");
  if (name === "padding" || name === "margin") {
    const [t, r, b, l] = boxValues(value);
    out.set(`${name}-top`, t);
    out.set(`${name}-right`, r);
    out.set(`${name}-bottom`, b);
    out.set(`${name}-left`, l);
  } else if (name === "background") {
    let color: string | null = null;
    let image = false;
    for (const t of tokens) {
      if (/url\(|gradient\(/i.test(t)) image = true;
      else if (parseColor(t)) color = t;
    }
    out.set("background-color", color ?? "transparent");
    if (image) out.set("background-image", "url()");
    else out.delete("background-image");
  } else if (name === "outline") {
    const none = tokens.some((t) => t === "none" || t === "0" || t === "0px" || t === "hidden");
    out.set("outline-style", none ? "none" : tokens.find((t) => /^(solid|dashed|dotted|double|groove|ridge|inset|outset|auto)$/.test(t)) ?? "solid");
    if (none) out.set("outline-width", "0");
  } else if (name === "font") {
    for (const t of tokens) {
      const size = /^(\d*\.?\d+(?:px|rem|em|pt|%))(?:\/(\S+))?$/.exec(t);
      if (size) {
        out.set("font-size", size[1]);
        if (size[2]) out.set("line-height", size[2]);
      } else if (/^(bold|bolder|[1-9]00)$/.test(t)) out.set("font-weight", t);
    }
  }
}

/** Resolves the cascade for elements of a page: declared styles, computed text/size metrics and effective backdrop colour. */
export class StyleResolver {
  private buckets = new Map<string, CssRule[]>();
  private declaredCache = new Map<number, Map<string, string>>();
  private varsCache = new Map<number, Map<string, string>>();
  private computedCache = new Map<number, ComputedStyle>();

  constructor(private page: PageModel) {
    for (const rule of page.rules) {
      if (rule.selector.unsupported || isStateful(rule.selector)) continue;
      const last = rule.selector.parts[rule.selector.parts.length - 1].compound;
      const key = last.id ? `#${last.id}` : last.classes.length ? `.${last.classes[0]}` : last.tag ? last.tag : "*";
      const list = this.buckets.get(key);
      if (list) list.push(rule);
      else this.buckets.set(key, [rule]);
    }
  }

  private candidates(idx: number): CssRule[] {
    const el = this.page.elements[idx];
    const out: CssRule[] = [];
    const add = (key: string) => {
      const l = this.buckets.get(key);
      if (l) out.push(...l);
    };
    if (el.attrs.id) add(`#${el.attrs.id}`);
    for (const c of classList(el)) add(`.${c}`);
    add(el.tag);
    add("*");
    return out;
  }

  private vars(idx: number, cascaded: Map<string, string>): Map<string, string> {
    const cached = this.varsCache.get(idx);
    if (cached) return cached;
    const el = this.page.elements[idx];
    const merged = new Map<string, string>(el.parent >= 0 ? this.varsFor(el.parent) : []);
    for (const [k, v] of cascaded) if (k.startsWith("--")) merged.set(k, v);
    this.varsCache.set(idx, merged);
    return merged;
  }

  private varsFor(idx: number): Map<string, string> {
    this.declared(idx);
    return this.varsCache.get(idx) as Map<string, string>;
  }

  /** Cascaded declarations (var() resolved, shorthands expanded) for the element itself, without inheritance. */
  declared(idx: number): Map<string, string> {
    const hit = this.declaredCache.get(idx);
    if (hit) return hit;
    const el = this.page.elements[idx];
    const entries: Array<{ prio: number; order: number; name: string; value: string }> = [];
    for (const rule of this.candidates(idx)) {
      if (!matchesSelector(this.page, idx, rule.selector)) continue;
      for (const [name, value] of Object.entries(rule.decls)) {
        entries.push({ prio: rule.selector.specificity + (rule.important.has(name) ? 1e7 : 0), order: rule.order, name, value });
      }
    }
    if (el.attrs.style) {
      const inline = parseDecls(el.attrs.style);
      for (const [name, value] of Object.entries(inline.decls)) entries.push({ prio: 1e6 + (inline.important.has(name) ? 1e7 : 0), order: Number.MAX_SAFE_INTEGER, name, value });
    }
    entries.sort((a, b) => a.prio - b.prio || a.order - b.order);
    const raw = new Map<string, string>();
    for (const e of entries) raw.set(e.name, e.value);
    const vars = this.vars(idx, raw);
    const out = new Map<string, string>();
    const resolved: Array<[string, string]> = [];
    for (const [k, v] of raw) if (!k.startsWith("--")) resolved.push([k, resolveVars(v, vars)]);
    for (const [k, v] of resolved) if (SHORTHANDS.has(k)) expandShorthand(k, v, out);
    for (const [k, v] of resolved) out.set(k, v);
    this.declaredCache.set(idx, out);
    return out;
  }

  computed(idx: number): ComputedStyle {
    const hit = this.computedCache.get(idx);
    if (hit) return hit;
    const el = this.page.elements[idx];
    const parent: ComputedStyle | null = el.parent >= 0 ? this.computed(el.parent) : null;
    const d = this.declared(idx);
    const parentFs = parent?.fontSizePx ?? 16;

    let color = parent?.color ?? { r: 0, g: 0, b: 0, a: 1 };
    const cv = d.get("color");
    if (cv) color = parseColor(cv) ?? color;

    let fontSizePx = parentFs * (UA_FONT_SCALE[el.tag] ?? 1);
    const fs = d.get("font-size");
    if (fs) {
      const kw = FONT_KEYWORDS[fs.toLowerCase()];
      if (kw !== undefined) fontSizePx = kw;
      else if (fs === "smaller") fontSizePx = parentFs * 0.83;
      else if (fs === "larger") fontSizePx = parentFs * 1.2;
      else if (fs.endsWith("%")) fontSizePx = (parseFloat(fs) / 100) * parentFs;
      else fontSizePx = lengthToPx(fs, parentFs) ?? fontSizePx;
    }

    let bold = parent?.bold ?? false;
    if (UA_BOLD.has(el.tag)) bold = true;
    const fw = d.get("font-weight");
    if (fw) bold = /^(bold|bolder|[6-9]00)$/i.test(fw.trim()) ? true : /^(normal|lighter|[1-5]00)$/i.test(fw.trim()) ? false : bold;

    const lhRaw = d.get("line-height") ?? parent?.lineHeightRaw ?? "normal";
    let lineHeightPx = fontSizePx * 1.2;
    if (/^\d*\.?\d+$/.test(lhRaw)) lineHeightPx = parseFloat(lhRaw) * fontSizePx;
    else if (lhRaw.endsWith("%")) lineHeightPx = (parseFloat(lhRaw) / 100) * fontSizePx;
    else if (lhRaw !== "normal") lineHeightPx = lengthToPx(lhRaw, fontSizePx) ?? lineHeightPx;

    const opacityRaw = d.get("opacity");
    const opacity = opacityRaw !== undefined && Number.isFinite(parseFloat(opacityRaw)) ? parseFloat(opacityRaw) : 1;
    const pad = (side: string) => Math.max(0, lengthToPx(d.get(`padding-${side}`), fontSizePx) ?? 0);

    const computed: ComputedStyle = {
      color,
      fontSizePx,
      bold,
      lineHeightPx,
      lineHeightRaw: lhRaw,
      display: (d.get("display") ?? "").toLowerCase(),
      position: (d.get("position") ?? "").toLowerCase(),
      opacity,
      width: lengthToPx(d.get("width"), fontSizePx),
      height: lengthToPx(d.get("height"), fontSizePx),
      minWidth: lengthToPx(d.get("min-width"), fontSizePx),
      minHeight: lengthToPx(d.get("min-height"), fontSizePx),
      padding: { t: pad("top"), r: pad("right"), b: pad("bottom"), l: pad("left") },
    };
    this.computedCache.set(idx, computed);
    return computed;
  }

  /** True when the element or an ancestor is display:none (declared in CSS). */
  isDisplayNone(idx: number): boolean {
    for (let i = idx; i >= 0; i = this.page.elements[i].parent) {
      if ((this.declared(i).get("display") ?? "").toLowerCase() === "none") return true;
    }
    return false;
  }

  /**
   * Effective opaque backdrop behind an element, compositing semi-transparent layers over the first opaque ancestor
   * (or white). `unknown` is set when a background image/gradient or an unresolvable colour is involved.
   */
  background(idx: number): { color: Rgba; unknown: boolean } {
    const layers: Rgba[] = [];
    let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = idx; i >= 0; i = this.page.elements[i].parent) {
      const d = this.declared(i);
      const img = (d.get("background-image") ?? "none").toLowerCase();
      if (img !== "none" && img !== "initial" && img !== "unset") return { color: base, unknown: true };
      const bg = d.get("background-color");
      if (bg === undefined || /^(inherit|initial|unset|revert)$/i.test(bg)) continue;
      const c = parseColor(bg);
      if (!c) return { color: base, unknown: true };
      if (c.a <= 0) continue;
      if (c.a >= 1) {
        base = c;
        break;
      }
      layers.push(c);
    }
    let out = base;
    for (let k = layers.length - 1; k >= 0; k--) out = blend(layers[k], out);
    return { color: { ...out, a: 1 }, unknown: false };
  }
}
