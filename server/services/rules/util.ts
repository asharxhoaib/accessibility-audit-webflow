import { cssPath, deepText, descendants, ElementNode, isStaticallyHidden, PageModel, snippet } from "../dom/model";
import { RawFinding } from "./types";

export function makeFinding(page: PageModel, idx: number, ruleId: string, message: string, extra: Partial<RawFinding> = {}): RawFinding {
  const el = page.elements[idx];
  return {
    ruleId,
    message,
    selector: cssPath(page, idx),
    snippet: snippet(el),
    nodeId: el.nodeId,
    htmlId: el.attrs.id || undefined,
    ...extra,
  };
}

/** Finding about the document as a whole rather than a single element. */
export function documentFinding(page: PageModel, ruleId: string, message: string, extra: Partial<RawFinding> = {}): RawFinding {
  const html = page.elements.find((e) => e.tag === "html");
  return {
    ruleId,
    message,
    selector: html ? "html" : "document",
    snippet: html ? snippet(html) : "<document>",
    ...extra,
  };
}

export function role(el: ElementNode): string {
  return (el.attrs.role ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

export function isVisible(page: PageModel, idx: number): boolean {
  return !isStaticallyHidden(page, idx);
}

/** Simplified accessible name computation: aria-labelledby, aria-label, content, image alt, svg title, title, value. */
export function accessibleName(page: PageModel, idx: number): string {
  const el = page.elements[idx];
  const labelledby = (el.attrs["aria-labelledby"] ?? "").trim();
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => (page.byId.get(id) ?? []).map((i) => deepText(page, i)).join(" "))
      .join(" ")
      .trim();
    if (text) return text;
  }
  const aria = (el.attrs["aria-label"] ?? "").trim();
  if (aria) return aria;
  if (el.tag === "img" || el.tag === "area" || (el.tag === "input" && (el.attrs.type ?? "").toLowerCase() === "image")) {
    const alt = (el.attrs.alt ?? "").trim();
    if (alt) return alt;
  }
  if (el.tag === "input") {
    const type = (el.attrs.type ?? "text").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) {
      const v = (el.attrs.value ?? "").trim();
      if (v) return v;
      if (type === "submit") return "Submit";
      if (type === "reset") return "Reset";
    }
  }
  const parts: string[] = [];
  if (el.text) parts.push(el.text);
  const walk = (i: number) => {
    for (const c of page.elements[i].children) {
      const child = page.elements[c];
      if (child.tag === "script" || child.tag === "style" || "hidden" in child.attrs || child.attrs["aria-hidden"] === "true") continue;
      if (child.tag === "img") {
        const alt = (child.attrs.alt ?? "").trim();
        if (alt) parts.push(alt);
      } else if (child.attrs["aria-label"]?.trim()) parts.push(child.attrs["aria-label"].trim());
      else if (child.tag === "title" && page.elements[child.parent]?.tag === "svg") parts.push(child.text);
      else {
        if (child.text) parts.push(child.text);
        walk(c);
      }
    }
  };
  walk(idx);
  const content = parts.join(" ").replace(/\s+/g, " ").trim();
  if (content) return content;
  if (el.tag === "svg") {
    const t = descendants(page, idx).map((i) => page.elements[i]).find((d) => d.tag === "title" && d.text);
    if (t) return t.text;
  }
  return (el.attrs.title ?? "").trim();
}
