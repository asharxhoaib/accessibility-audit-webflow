import { blend, contrastRatio, toHex } from "../dom/color";
import { hasAncestor, isStaticallyHidden } from "../dom/model";
import { makeFinding } from "./util";
import { RawFinding, Rule } from "./types";

const SKIP_TAGS = new Set(["html", "head", "title", "script", "style", "noscript", "template", "option", "svg", "canvas"]);

/**
 * 1.4.3 (AA) and, when enabled, 1.4.6 (AAA): contrast ratio of resolved text colour against the resolved backdrop.
 * Colours come from the cascade (classes, inline styles, CSS variables), not from rendering.
 */
export const colorContrastRule: Rule = {
  category: "color-contrast",
  run({ page, resolver, includeAAA }) {
    const out: RawFinding[] = [];
    if (!page.stylesLoaded) return out;
    for (const el of page.elements) {
      if (SKIP_TAGS.has(el.tag) || el.text.trim() === "") continue;
      if (isStaticallyHidden(page, el.idx) || resolver.isDisplayNone(el.idx) || hasAncestor(page, el.idx, ["svg"])) continue;
      if ("disabled" in el.attrs || el.attrs["aria-disabled"] === "true") continue;
      const style = resolver.computed(el.idx);
      const bg = resolver.background(el.idx);
      if (bg.unknown || style.opacity <= 0) continue;
      const fg = blend(style.color, bg.color);
      const ratio = contrastRatio({ ...fg, a: 1 }, bg.color);
      const large = style.fontSizePx >= 24 || (style.bold && style.fontSizePx >= 18.66);
      const required = large ? 3 : 4.5;
      const details = {
        ratio: Math.floor(ratio * 100) / 100,
        required,
        foreground: toHex(fg),
        background: toHex(bg.color),
        fontSizePx: Math.round(style.fontSizePx * 100) / 100,
        largeText: large,
      };
      if (ratio < required) {
        out.push(makeFinding(page, el.idx, "color-contrast", `Contrast ratio ${details.ratio}:1 between ${details.foreground} text and ${details.background} background; ${required}:1 is required.`, { details }));
      } else if (includeAAA) {
        const enhanced = large ? 4.5 : 7;
        if (ratio < enhanced) {
          out.push(makeFinding(page, el.idx, "color-contrast-enhanced", `Contrast ratio ${details.ratio}:1 passes AA but is below the AAA target of ${enhanced}:1.`, { details: { ...details, required: enhanced } }));
        }
      }
    }
    return out;
  },
};
