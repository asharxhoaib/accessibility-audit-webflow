import { Impact } from "../../../shared/types";
import { makeFinding } from "./util";
import { RawFinding, Rule } from "./types";

/** Duplicate ids (maps to 1.3.1 because 4.1.1 Parsing is obsolete in WCAG 2.2). Severity rises when the id is referenced. */
export const duplicateIdsRule: Rule = {
  category: "duplicate-ids",
  run({ page }) {
    const out: RawFinding[] = [];
    const referenced = new Set<string>();
    for (const el of page.elements) {
      if (el.tag === "label" && el.attrs.for) referenced.add(el.attrs.for);
      for (const a of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "headers"]) {
        for (const id of (el.attrs[a] ?? "").split(/\s+/)) if (id) referenced.add(id);
      }
      if (el.tag === "a" && el.attrs.href?.startsWith("#") && el.attrs.href.length > 1) referenced.add(decodeURIComponent(el.attrs.href.slice(1)));
    }
    for (const [id, idxs] of page.byId) {
      if (idxs.length < 2) continue;
      const isRef = referenced.has(id);
      const impact: Impact = isRef ? "serious" : "minor";
      for (const idx of idxs.slice(1)) {
        out.push(makeFinding(page, idx, "duplicate-id", `id="${id}" is used ${idxs.length} times on this page${isRef ? " and is referenced by a label, ARIA attribute or anchor" : ""}.`, { impact, details: { id, occurrences: idxs.length, referenced: isRef } }));
      }
    }
    return out;
  },
};
