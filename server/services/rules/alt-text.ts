import { hasAncestor } from "../dom/model";
import { accessibleName, isVisible, makeFinding, role } from "./util";
import { RawFinding, Rule } from "./types";

const FILE_NAME = /\.(png|jpe?g|gif|svg|webp|avif|bmp|tiff?)$/i;
const CAMERA_NAME = /^(img|image|dsc|dscn|screenshot|screen shot|photo|pic|untitled)[-_ ]?\d*$/i;
const GENERIC = new Set(["image", "photo", "picture", "graphic", "img", "icon", "logo image", "placeholder", "alt", "alt text", "spacer"]);

/** 1.1.1: images need a text alternative; alt="" is valid for decorative images. */
export const altTextRule: Rule = {
  category: "alt-text",
  run({ page }) {
    const out: RawFinding[] = [];
    for (const el of page.elements) {
      if (!isVisible(page, el.idx)) continue;
      const r = role(el);
      if (el.tag === "img") {
        if (r === "presentation" || r === "none") continue;
        const alt = el.attrs.alt;
        if (alt === undefined) {
          if (el.attrs["aria-label"]?.trim() || el.attrs["aria-labelledby"]?.trim() || el.attrs.title?.trim()) continue;
          out.push(makeFinding(page, el.idx, "missing-alt", "Image has no alt attribute. Add descriptive alt text, or an empty alt if it is purely decorative."));
        } else if (alt.trim() !== "") {
          const t = alt.trim();
          if (FILE_NAME.test(t) || CAMERA_NAME.test(t) || GENERIC.has(t.toLowerCase())) {
            out.push(makeFinding(page, el.idx, "alt-quality", `Alt text "${t.length > 60 ? `${t.slice(0, 57)}...` : t}" is a file name or generic word and does not describe the image.`));
          }
        }
      } else if (el.tag === "input" && (el.attrs.type ?? "").toLowerCase() === "image") {
        if (!accessibleName(page, el.idx)) out.push(makeFinding(page, el.idx, "missing-alt", "Image button has no alt text describing its action."));
      } else if (el.tag === "area" && el.attrs.href !== undefined) {
        if (!accessibleName(page, el.idx)) out.push(makeFinding(page, el.idx, "missing-alt", "Image map area has no alt text."));
      } else if (el.tag === "svg" && r === "img") {
        if (!accessibleName(page, el.idx)) out.push(makeFinding(page, el.idx, "missing-alt", "SVG with role=\"img\" has no accessible name (aria-label or <title>)."));
      } else if (el.tag === "object" && (el.attrs.type ?? "").startsWith("image/") && !hasAncestor(page, el.idx, ["object"])) {
        if (!accessibleName(page, el.idx)) out.push(makeFinding(page, el.idx, "missing-alt", "Embedded image object has no text alternative."));
      }
    }
    return out;
  },
};
