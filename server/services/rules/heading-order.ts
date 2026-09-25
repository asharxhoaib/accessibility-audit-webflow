import { deepText } from "../dom/model";
import { accessibleName, documentFinding, isVisible, makeFinding } from "./util";
import { RawFinding, Rule } from "./types";

function levelOf(tag: string, ariaLevel: string | undefined, roleAttr: string | undefined): number | null {
  const m = /^h([1-6])$/.exec(tag);
  if (m && roleAttr !== "presentation" && roleAttr !== "none") return Number(m[1]);
  if (roleAttr === "heading") {
    const n = Number(ariaLevel);
    return Number.isInteger(n) && n >= 1 && n <= 9 ? n : 2;
  }
  return null;
}

/** 1.3.1 / 2.4.6: heading structure. */
export const headingOrderRule: Rule = {
  category: "heading-order",
  run({ page }) {
    const out: RawFinding[] = [];
    const headings: Array<{ idx: number; level: number }> = [];
    for (const el of page.elements) {
      const level = levelOf(el.tag, el.attrs["aria-level"], (el.attrs.role ?? "").toLowerCase() || undefined);
      if (level === null || !isVisible(page, el.idx)) continue;
      headings.push({ idx: el.idx, level });
    }
    let prev = 0;
    for (const h of headings) {
      if (deepText(page, h.idx) === "" && !accessibleName(page, h.idx)) {
        out.push(makeFinding(page, h.idx, "heading-empty", `Empty h${h.level} heading.`));
        continue;
      }
      if (prev > 0 && h.level > prev + 1) {
        out.push(makeFinding(page, h.idx, "heading-skip", `Heading level jumps from h${prev} to h${h.level}.`, { details: { from: prev, to: h.level } }));
      }
      prev = h.level;
    }
    const h1s = headings.filter((h) => h.level === 1 && deepText(page, h.idx) !== "");
    if (page.hasDocument || headings.length > 0) {
      if (h1s.length === 0 && page.hasDocument) {
        out.push(documentFinding(page, "heading-no-h1", "The page has no h1 heading."));
      }
      for (const extra of h1s.slice(1)) {
        out.push(makeFinding(page, extra.idx, "heading-multiple-h1", `This is h1 number ${h1s.indexOf(extra) + 1} on the page; a page should have one.`));
      }
    }
    return out;
  },
};
