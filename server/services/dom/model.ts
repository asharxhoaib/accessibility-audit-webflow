// Normalised page model shared by the rule engine. Built from published HTML (preferred) or the Pages DOM API.

export interface ElementNode {
  idx: number;
  tag: string;
  attrs: Record<string, string>;
  parent: number;
  children: number[];
  /** Text directly inside this element (not descendants). */
  text: string;
  /** Raw contents for <style>/<script> elements. */
  raw?: string;
  /** Webflow Designer element id, when it could be mapped from the Pages DOM API. */
  nodeId?: string;
}

export interface SimpleCompound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; op?: string; value?: string }>;
  /** Structural pseudo-classes that are evaluated ("root", "first-child", "last-child"). */
  structural: string[];
  /** State pseudo-classes (hover, focus, focus-visible, ...): ignored when matching, recorded for analysis. */
  states: string[];
}

export interface ParsedSelector {
  raw: string;
  parts: Array<{ combinator: " " | ">" | null; compound: SimpleCompound }>;
  specificity: number;
  /** Selector cannot be evaluated (sibling combinators, :not(), pseudo-elements, ...). */
  unsupported: boolean;
}

export interface CssRule {
  selector: ParsedSelector;
  decls: Record<string, string>;
  important: Set<string>;
  order: number;
  text: string;
}

export type PageSource = "published-html" | "dom-api";

export interface PageModel {
  pageId: string;
  title: string;
  path: string;
  url: string;
  source: PageSource;
  /** True when a real <html> document was parsed (landmark and language rules need it). */
  hasDocument: boolean;
  elements: ElementNode[];
  rules: CssRule[];
  /** True when at least one stylesheet or <style> block was parsed, so style-dependent rules can run. */
  stylesLoaded: boolean;
  byId: Map<string, number[]>;
}

export function indexIds(page: PageModel): void {
  page.byId = new Map();
  for (const el of page.elements) {
    const id = el.attrs.id;
    if (id) {
      const list = page.byId.get(id);
      if (list) list.push(el.idx);
      else page.byId.set(id, [el.idx]);
    }
  }
}

const HIDDEN_CLASSES = ["w-condition-invisible", "w-dyn-hide", "w-hidden", "w-hidden-main", "w-hidden-medium", "w-hidden-small", "w-hidden-tiny"];

export function classList(el: ElementNode): string[] {
  return (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

/** Static hiddenness (attributes and Webflow utility classes). Computed display:none is checked by rules that resolve styles. */
export function isStaticallyHidden(page: PageModel, idx: number): boolean {
  for (let i = idx; i >= 0; i = page.elements[i].parent) {
    const el = page.elements[i];
    if ("hidden" in el.attrs) return true;
    if (el.attrs["aria-hidden"] === "true" && i === idx) return true;
    if (el.tag === "head" || el.tag === "script" || el.tag === "style" || el.tag === "template" || el.tag === "noscript") return true;
    if (el.tag === "input" && (el.attrs.type ?? "").toLowerCase() === "hidden") return true;
    const classes = classList(el);
    if (classes.some((c) => HIDDEN_CLASSES.includes(c))) return true;
    if (/(^|;)\s*display\s*:\s*none/i.test(el.attrs.style ?? "")) return true;
  }
  return false;
}

const textCache = new WeakMap<PageModel, Map<number, string>>();

/** Text of an element and all descendants, whitespace-collapsed. Skips hidden descendants. */
export function deepText(page: PageModel, idx: number): string {
  let cache = textCache.get(page);
  if (!cache) {
    cache = new Map();
    textCache.set(page, cache);
  }
  const hit = cache.get(idx);
  if (hit !== undefined) return hit;
  const el = page.elements[idx];
  const parts: string[] = [];
  if (el.text) parts.push(el.text);
  for (const c of el.children) {
    const child = page.elements[c];
    if (child.tag === "script" || child.tag === "style" || "hidden" in child.attrs || child.attrs["aria-hidden"] === "true") continue;
    parts.push(deepText(page, c));
  }
  const out = parts.join(" ").replace(/\s+/g, " ").trim();
  cache.set(idx, out);
  return out;
}

export function hasAncestor(page: PageModel, idx: number, tags: string[]): boolean {
  for (let p = page.elements[idx].parent; p >= 0; p = page.elements[p].parent) if (tags.includes(page.elements[p].tag)) return true;
  return false;
}

export function descendants(page: PageModel, idx: number): number[] {
  const out: number[] = [];
  const walk = (i: number) => {
    for (const c of page.elements[i].children) {
      out.push(c);
      walk(c);
    }
  };
  walk(idx);
  return out;
}

const cssEscape = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

/** Readable CSS path, anchored at the nearest unique id. */
export function cssPath(page: PageModel, idx: number): string {
  const segs: string[] = [];
  for (let i = idx; i >= 0; i = page.elements[i].parent) {
    const el = page.elements[i];
    if (el.tag === "html" || el.tag === "body") {
      if (segs.length === 0) segs.unshift(el.tag);
      break;
    }
    const id = el.attrs.id;
    if (id && page.byId.get(id)?.length === 1) {
      segs.unshift(`${el.tag}#${cssEscape(id)}`);
      break;
    }
    let seg = el.tag;
    const cls = classList(el).slice(0, 2);
    if (cls.length) seg += cls.map((c) => `.${cssEscape(c)}`).join("");
    const parent = el.parent >= 0 ? page.elements[el.parent] : null;
    if (parent) {
      const sameTag = parent.children.filter((c) => page.elements[c].tag === el.tag);
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(i) + 1})`;
    }
    segs.unshift(seg);
    if (segs.length >= 6) break;
  }
  return segs.join(" > ");
}

export function snippet(el: ElementNode, max = 200): string {
  const attrs = Object.entries(el.attrs)
    .filter(([k]) => k !== "style" && !k.startsWith("data-w-") && k !== "srcset" && k !== "sizes")
    .map(([k, v]) => (v === "" ? k : `${k}="${v.length > 60 ? `${v.slice(0, 57)}...` : v}"`))
    .join(" ");
  const s = `<${el.tag}${attrs ? ` ${attrs}` : ""}>`;
  return s.length > max ? `${s.slice(0, max - 4)}...>` : s;
}
