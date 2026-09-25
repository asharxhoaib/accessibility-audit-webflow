import { ElementNode } from "./model";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const AUTO_CLOSE: Record<string, string[]> = {
  li: ["li"],
  option: ["option"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
};
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "section", "table", "ul"]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const WS = /\s/;

/**
 * Tolerant HTML tokenizer/tree builder. Appends parsed elements to `into` (document order, so index order is
 * document order). `rootParent` attaches top-level parsed elements to an existing element.
 */
export function parseHtml(html: string, into: ElementNode[] = [], rootParent = -1): ElementNode[] {
  const stack: number[] = rootParent >= 0 ? [rootParent] : [];
  const n = html.length;
  let i = 0;
  const top = () => (stack.length ? stack[stack.length - 1] : -1);

  const addText = (t: string) => {
    const p = top();
    if (p >= 0 && t.trim() !== "") into[p].text += `${into[p].text ? " " : ""}${decodeEntities(t)}`;
  };
  const closeTag = (name: string) => {
    for (let k = stack.length - 1; k >= (rootParent >= 0 ? 1 : 0); k--) {
      if (into[stack[k]].tag === name) {
        stack.length = k;
        return;
      }
    }
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));
    const next = html[lt + 1];
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === "/") {
      const end = html.indexOf(">", lt);
      closeTag(html.slice(lt + 2, end === -1 ? n : end).trim().split(/\s/)[0].toLowerCase());
      i = end === -1 ? n : end + 1;
      continue;
    }
    const nameRe = /<([a-zA-Z][a-zA-Z0-9:-]*)/y;
    nameRe.lastIndex = lt;
    const m = nameRe.exec(html);
    if (!m) {
      addText("<");
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClose = false;
    for (;;) {
      while (j < n && WS.test(html[j])) j++;
      if (j >= n) break;
      const c = html[j];
      if (c === ">") {
        j++;
        break;
      }
      if (c === "/") {
        if (html[j + 1] === ">") {
          selfClose = true;
          j += 2;
          break;
        }
        j++;
        continue;
      }
      const attrRe = /[^\s=>/]+/y;
      attrRe.lastIndex = j;
      const am = attrRe.exec(html);
      if (!am) {
        j++;
        continue;
      }
      j += am[0].length;
      while (j < n && WS.test(html[j])) j++;
      let val = "";
      if (html[j] === "=") {
        j++;
        while (j < n && WS.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const e = html.indexOf(q, j + 1);
          val = html.slice(j + 1, e === -1 ? n : e);
          j = e === -1 ? n : e + 1;
        } else {
          const vRe = /[^\s>]+/y;
          vRe.lastIndex = j;
          const vm = vRe.exec(html);
          val = vm ? vm[0] : "";
          j += val.length;
        }
      }
      const key = am[0].toLowerCase();
      if (!(key in attrs)) attrs[key] = decodeEntities(val);
    }
    i = j;

    // Implicit end tags.
    const closers = AUTO_CLOSE[tag];
    if (closers && closers.includes(into[top()]?.tag ?? "")) stack.pop();
    if (CLOSES_P.has(tag) && into[top()]?.tag === "p") stack.pop();

    const parent = top();
    const el: ElementNode = { idx: into.length, tag, attrs, parent, children: [], text: "" };
    into.push(el);
    if (parent >= 0) into[parent].children.push(el.idx);

    if (VOID.has(tag) || selfClose) continue;
    if (RAW_TEXT.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, "ig");
      endRe.lastIndex = i;
      const em = endRe.exec(html);
      const content = html.slice(i, em ? em.index : n);
      if (tag === "script" || tag === "style") el.raw = content;
      else el.text = decodeEntities(content).trim();
      i = em ? em.index + em[0].length : n;
      continue;
    }
    stack.push(el.idx);
  }
  return into;
}
