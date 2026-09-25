import { accessibleName, isVisible, makeFinding, role } from "./util";
import { RawFinding, Rule } from "./types";

/** 2.4.4 / 4.1.2: links and buttons must expose a name. */
export const emptyControlsRule: Rule = {
  category: "empty-controls",
  run({ page }) {
    const out: RawFinding[] = [];
    for (const el of page.elements) {
      const r = role(el);
      const isLink = (el.tag === "a" && (el.attrs.href !== undefined || r === "link")) || r === "link";
      const isButton = el.tag === "button" || r === "button" || (el.tag === "input" && ["button", "submit", "reset"].includes((el.attrs.type ?? "").toLowerCase()));
      if (!isLink && !isButton) continue;
      if (!isVisible(page, el.idx)) continue;
      if (accessibleName(page, el.idx)) continue;
      if (isButton && !isLink) {
        out.push(makeFinding(page, el.idx, "empty-button", "Button has no text, aria-label or title, so assistive technology cannot announce its purpose."));
      } else {
        out.push(makeFinding(page, el.idx, "empty-link", "Link has no text, image alt, aria-label or title, so assistive technology cannot announce where it goes."));
      }
    }
    return out;
  },
};
