import { deepText, hasAncestor } from "../dom/model";
import { isVisible, makeFinding, role } from "./util";
import { RawFinding, Rule } from "./types";

const MIN = 24;
const BLOCKISH = new Set(["block", "flex", "grid", "table", "list-item", "flow-root"]);

/**
 * 2.5.8 (Target Size Minimum, AA). Heuristic: estimates each target's box from resolved width/height/padding and text metrics,
 * and only reports when the estimate is confidently below 24 x 24 CSS px. Inline links inside running text are exempt.
 */
export const tapTargetsRule: Rule = {
  category: "tap-targets",
  run({ page, resolver }) {
    const out: RawFinding[] = [];
    if (!page.stylesLoaded) return out;
    for (const el of page.elements) {
      const r = role(el);
      const type = (el.attrs.type ?? "").toLowerCase();
      const isTarget =
        (el.tag === "a" && el.attrs.href !== undefined) || el.tag === "button" || el.tag === "select" || el.tag === "summary" || r === "button" || r === "link" ||
        (el.tag === "input" && !["hidden"].includes(type));
      if (!isTarget || !isVisible(page, el.idx) || resolver.isDisplayNone(el.idx) || "disabled" in el.attrs) continue;
      if ((el.tag === "input" && (type === "checkbox" || type === "radio")) && hasAncestor(page, el.idx, ["label"])) continue;
      const parent = el.parent >= 0 ? page.elements[el.parent] : null;
      if (el.tag === "a" && parent && (parent.text.trim() !== "" || hasAncestor(page, el.idx, ["p"]) || parent.tag === "p")) continue; // inline link in a sentence
      const s = resolver.computed(el.idx);
      if (s.position === "absolute" && s.opacity === 0) continue;

      let width: number | null = s.width;
      let height: number | null = s.height;
      const text = deepText(page, el.idx);
      const attrW = Number(el.attrs.width);
      const attrH = Number(el.attrs.height);
      const img = el.children.map((c) => page.elements[c]).find((c) => c.tag === "img" || c.tag === "svg");

      if (el.tag === "input" && (type === "checkbox" || type === "radio")) {
        width = width ?? 13;
        height = height ?? 13;
      } else {
        if (height === null && text !== "") height = s.lineHeightPx + s.padding.t + s.padding.b;
        if (height === null && img && Number.isFinite(Number(img.attrs.height)) && Number(img.attrs.height) > 0) height = Number(img.attrs.height) + s.padding.t + s.padding.b;
        if (height === null && Number.isFinite(attrH) && attrH > 0) height = attrH;
        if (width === null && !BLOCKISH.has(s.display) && s.minWidth === null) {
          if (text !== "") width = text.length * s.fontSizePx * 0.5 + s.padding.l + s.padding.r;
          else if (img && Number.isFinite(Number(img.attrs.width)) && Number(img.attrs.width) > 0) width = Number(img.attrs.width) + s.padding.l + s.padding.r;
          else if (Number.isFinite(attrW) && attrW > 0) width = attrW;
        }
      }
      if (s.minHeight !== null && height !== null) height = Math.max(height, s.minHeight);
      if (s.minWidth !== null && width !== null) width = Math.max(width, s.minWidth);
      const smallW = width !== null && width < MIN;
      const smallH = height !== null && height < MIN;
      if (!smallW && !smallH) continue;
      const w = width === null ? "auto" : `${Math.round(width)}px`;
      const h = height === null ? "auto" : `${Math.round(height)}px`;
      out.push(makeFinding(page, el.idx, "tap-target-size", `Estimated target size ${w} by ${h} is below the 24 by 24 CSS pixel minimum.`, { details: { estimatedWidth: width === null ? null : Math.round(width), estimatedHeight: height === null ? null : Math.round(height), minimum: MIN } }));
    }
    return out;
  },
};
