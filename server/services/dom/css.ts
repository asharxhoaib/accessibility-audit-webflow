import { CssRule, ElementNode, PageModel, ParsedSelector, SimpleCompound, classList } from "./model";

const STATE_PSEUDOS = new Set([
  "hover", "focus", "focus-visible", "focus-within", "active", "visited", "link", "any-link", "target", "disabled", "enabled",
  "checked", "required", "optional", "invalid", "valid", "placeholder-shown", "read-only", "read-write", "indeterminate",
]);
const STRUCTURAL_PSEUDOS = new Set(["root", "first-child", "last-child"]);
const IDENT = /[a-zA-Z0-9_\- -￿]/;

/** Splits on `sep` outside parentheses and quotes. */
export function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of input) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

function newCompound(): SimpleCompound {
  return { classes: [], attrs: [], structural: [], states: [] };
}

export function parseSelector(raw: string): ParsedSelector {
  const s = raw.trim();
  const parts: ParsedSelector["parts"] = [];
  let cur: SimpleCompound | null = null;
  let pending: " " | ">" | null = null;
  let unsupported = false;
  let ids = 0;
  let mids = 0;
  let tags = 0;
  const flush = () => {
    if (cur) {
      parts.push({ combinator: parts.length === 0 ? null : pending ?? " ", compound: cur });
      cur = null;
      pending = null;
    }
  };
  const readIdent = (from: number): string => {
    let k = from;
    while (k < s.length && IDENT.test(s[k])) k++;
    return s.slice(from, k);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (cur) {
        flush();
        pending = " ";
      }
      continue;
    }
    if (c === ">") {
      flush();
      pending = ">";
      i++;
      continue;
    }
    if (c === "+" || c === "~") {
      unsupported = true;
      i++;
      continue;
    }
    if (!cur) cur = newCompound();
    if (c === "*") {
      i++;
    } else if (c === ".") {
      const id = readIdent(i + 1);
      if (!id) unsupported = true;
      cur.classes.push(id);
      mids++;
      i += 1 + id.length;
    } else if (c === "#") {
      const id = readIdent(i + 1);
      if (!id) unsupported = true;
      cur.id = id;
      ids++;
      i += 1 + id.length;
    } else if (c === "[") {
      const end = s.indexOf("]", i);
      if (end === -1) {
        unsupported = true;
        break;
      }
      const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*(?:[is])?\s*$/.exec(s.slice(i + 1, end));
      if (m) cur.attrs.push({ name: m[1].toLowerCase(), op: m[2], value: m[3] ?? m[4] ?? m[5] });
      else unsupported = true;
      mids++;
      i = end + 1;
    } else if (c === ":") {
      if (s[i + 1] === ":") {
        unsupported = true;
        i += 2 + readIdent(i + 2).length;
        continue;
      }
      const name = readIdent(i + 1).toLowerCase();
      i += 1 + name.length;
      if (s[i] === "(") {
        unsupported = true;
        let depth = 0;
        while (i < s.length) {
          if (s[i] === "(") depth++;
          else if (s[i] === ")" && --depth === 0) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (STRUCTURAL_PSEUDOS.has(name)) cur.structural.push(name);
      else if (STATE_PSEUDOS.has(name)) cur.states.push(name);
      else unsupported = true;
      mids++;
    } else if (IDENT.test(c)) {
      const t = readIdent(i);
      cur.tag = t.toLowerCase();
      tags++;
      i += t.length;
    } else {
      unsupported = true;
      i++;
    }
  }
  flush();
  if (parts.length === 0) unsupported = true;
  // State pseudo-classes are only understood on the subject (last) compound.
  for (let k = 0; k < parts.length - 1; k++) if (parts[k].compound.states.length) unsupported = true;
  return { raw: s, parts, specificity: ids * 10000 + mids * 100 + tags, unsupported };
}

export function isStateful(sel: ParsedSelector): boolean {
  return sel.parts.length > 0 && sel.parts[sel.parts.length - 1].compound.states.length > 0;
}

function matchCompound(page: PageModel, el: ElementNode, c: SimpleCompound): boolean {
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id !== undefined && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const have = classList(el);
    for (const cls of c.classes) if (!have.includes(cls)) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (!a.op) continue;
    const want = a.value ?? "";
    switch (a.op) {
      case "=": if (v !== want) return false; break;
      case "~=": if (!v.split(/\s+/).includes(want)) return false; break;
      case "^=": if (!v.startsWith(want)) return false; break;
      case "$=": if (!v.endsWith(want)) return false; break;
      case "*=": if (!v.includes(want)) return false; break;
      case "|=": if (v !== want && !v.startsWith(`${want}-`)) return false; break;
      default: return false;
    }
  }
  for (const st of c.structural) {
    if (st === "root" && el.tag !== "html") return false;
    if (st === "first-child" || st === "last-child") {
      const siblings = el.parent >= 0 ? page.elements[el.parent].children : [];
      if (siblings.length === 0) return false;
      if (st === "first-child" ? siblings[0] !== el.idx : siblings[siblings.length - 1] !== el.idx) return false;
    }
  }
  return true;
}

function matchFrom(page: PageModel, idx: number, sel: ParsedSelector, k: number): boolean {
  if (k === 0) return true;
  const comb = sel.parts[k].combinator;
  const el = page.elements[idx];
  if (comb === ">") {
    const p = el.parent;
    return p >= 0 && matchCompound(page, page.elements[p], sel.parts[k - 1].compound) && matchFrom(page, p, sel, k - 1);
  }
  for (let p = el.parent; p >= 0; p = page.elements[p].parent) {
    if (matchCompound(page, page.elements[p], sel.parts[k - 1].compound) && matchFrom(page, p, sel, k - 1)) return true;
  }
  return false;
}

/** Matches structure only: state pseudo-classes (:hover, :focus...) on the subject are ignored. */
export function matchesSelector(page: PageModel, idx: number, sel: ParsedSelector): boolean {
  if (sel.unsupported || sel.parts.length === 0) return false;
  const k = sel.parts.length - 1;
  return matchCompound(page, page.elements[idx], sel.parts[k].compound) && matchFrom(page, idx, sel, k);
}

export function parseDecls(body: string): { decls: Record<string, string>; important: Set<string> } {
  const decls: Record<string, string> = {};
  const important = new Set<string>();
  for (const chunk of splitTopLevel(body, ";")) {
    const colon = chunk.indexOf(":");
    if (colon <= 0) continue;
    let name = chunk.slice(0, colon).trim();
    if (!name.startsWith("--")) name = name.toLowerCase();
    let value = chunk.slice(colon + 1).trim();
    const imp = /\s*!\s*important\s*$/i.test(value);
    if (imp) value = value.replace(/\s*!\s*important\s*$/i, "").trim();
    if (!name || value === "") continue;
    decls[name] = value;
    if (imp) important.add(name);
    else important.delete(name);
  }
  return { decls, important };
}

/** Parses top-level style rules. At-rules (@media, @font-face, ...) are skipped: audits use the base (desktop-first) cascade. */
export function parseCss(css: string, orderStart = 0): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const n = src.length;
  let order = orderStart;
  let i = 0;
  while (i < n) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < n && depth > 0) {
      const ch = src[j];
      if (ch === '"' || ch === "'") {
        const e = src.indexOf(ch, j + 1);
        j = e === -1 ? n : e + 1;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, Math.max(open + 1, j - 1));
    i = j;
    if (prelude.startsWith("@") || prelude === "") continue;
    const { decls, important } = parseDecls(body);
    if (Object.keys(decls).length === 0) continue;
    order++;
    for (const raw of splitTopLevel(prelude, ",")) {
      const selector = parseSelector(raw);
      if (selector.unsupported) continue;
      rules.push({ selector, decls, important, order, text: `${raw} { ${body.trim().replace(/\s+/g, " ").slice(0, 300)} }` });
    }
  }
  return rules;
}
