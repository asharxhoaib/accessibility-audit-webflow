import { isVisible, makeFinding } from "./util";
import { RawFinding, Rule } from "./types";

const NON_LABELLED_INPUT = new Set(["hidden", "submit", "button", "reset", "image"]);

/** 3.3.2 (and 1.3.1 / 4.1.2): every form control needs a programmatic label. */
export const formLabelsRule: Rule = {
  category: "form-labels",
  run({ page }) {
    const out: RawFinding[] = [];
    const labelFor = new Map<string, number[]>();
    for (const el of page.elements) {
      if (el.tag === "label" && el.attrs.for) {
        const l = labelFor.get(el.attrs.for);
        if (l) l.push(el.idx);
        else labelFor.set(el.attrs.for, [el.idx]);
      }
    }
    const labelHasContent = (idx: number): boolean => {
      const walk = (i: number): boolean => {
        const e = page.elements[i];
        if (e.text.trim() !== "") return true;
        if (e.tag === "img" && (e.attrs.alt ?? "").trim() !== "") return true;
        if ((e.attrs["aria-label"] ?? "").trim() !== "") return true;
        return e.children.some((c) => page.elements[c].tag !== "input" && page.elements[c].tag !== "select" && page.elements[c].tag !== "textarea" && walk(c));
      };
      return walk(idx);
    };
    for (const el of page.elements) {
      const isControl = el.tag === "select" || el.tag === "textarea" || (el.tag === "input" && !NON_LABELLED_INPUT.has((el.attrs.type ?? "text").toLowerCase()));
      if (!isControl || !isVisible(page, el.idx)) continue;
      if ((el.attrs["aria-label"] ?? "").trim() || (el.attrs.title ?? "").trim()) continue;
      const lb = (el.attrs["aria-labelledby"] ?? "").trim();
      if (lb && lb.split(/\s+/).some((id) => page.byId.has(id))) continue;
      const byFor = el.attrs.id ? labelFor.get(el.attrs.id) ?? [] : [];
      if (byFor.some(labelHasContent)) continue;
      let wrapped = false;
      for (let p = el.parent; p >= 0; p = page.elements[p].parent) {
        if (page.elements[p].tag === "label" && labelHasContent(p)) {
          wrapped = true;
          break;
        }
      }
      if (wrapped) continue;
      const type = el.tag === "input" ? `${el.attrs.type ?? "text"} input` : el.tag;
      const hint = (el.attrs.placeholder ?? "").trim() ? " A placeholder is not a substitute for a label." : "";
      out.push(makeFinding(page, el.idx, "form-label", `The ${type}${el.attrs.name ? ` "${el.attrs.name}"` : ""} has no associated label.${hint}`));
    }
    return out;
  },
};
