import { hasAncestor } from "../dom/model";
import { documentFinding, isVisible, makeFinding, role } from "./util";
import { RawFinding, Rule } from "./types";

/** 2.4.1 / 1.3.1: page regions. Needs a real document, so it is skipped for DOM-API-only pages. */
export const landmarksRule: Rule = {
  category: "landmarks",
  run({ page }) {
    const out: RawFinding[] = [];
    if (!page.hasDocument) return out;
    const mains: number[] = [];
    const navs: number[] = [];
    let banner = false;
    let contentinfo = false;
    for (const el of page.elements) {
      if (!isVisible(page, el.idx)) continue;
      const r = role(el);
      if (el.tag === "main" || r === "main") mains.push(el.idx);
      if (el.tag === "nav" || r === "navigation") navs.push(el.idx);
      const scoped = hasAncestor(page, el.idx, ["article", "aside", "main", "nav", "section"]);
      if (r === "banner" || (el.tag === "header" && !scoped && !r)) banner = true;
      if (r === "contentinfo" || (el.tag === "footer" && !scoped && !r)) contentinfo = true;
    }
    if (mains.length === 0) out.push(documentFinding(page, "landmark-main", "No <main> element or role=\"main\" was found."));
    for (const extra of mains.slice(1)) out.push(makeFinding(page, extra, "landmark-main-multiple", "Additional main landmark; a page should have exactly one."));
    if (!banner) out.push(documentFinding(page, "landmark-banner", "No <header> or role=\"banner\" landmark was found."));
    if (!contentinfo) out.push(documentFinding(page, "landmark-contentinfo", "No <footer> or role=\"contentinfo\" landmark was found."));
    if (navs.length > 1) {
      const unlabelled = navs.filter((i) => !(page.elements[i].attrs["aria-label"] ?? "").trim() && !(page.elements[i].attrs["aria-labelledby"] ?? "").trim());
      if (unlabelled.length > 1) {
        for (const i of unlabelled) out.push(makeFinding(page, i, "landmark-nav-label", `${navs.length} navigation landmarks exist and this one has no aria-label to tell them apart.`));
      }
    }
    return out;
  },
};
