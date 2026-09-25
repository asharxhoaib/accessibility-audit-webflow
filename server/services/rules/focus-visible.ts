import { matchesSelector } from "../dom/css";
import { CssRule } from "../dom/model";
import { isVisible, makeFinding, role } from "./util";
import { RawFinding, Rule } from "./types";

const FOCUS_STATES = ["focus", "focus-visible"];
const COMPENSATING = ["box-shadow", "border", "border-color", "border-width", "border-style", "border-top-color", "border-bottom-color", "border-bottom", "border-top", "border-left", "border-right", "background", "background-color", "text-decoration", "text-decoration-line", "text-decoration-color", "filter", "transform"];

function removesOutline(decls: Record<string, string>): boolean {
  const o = (decls.outline ?? "").toLowerCase();
  const style = (decls["outline-style"] ?? "").toLowerCase();
  const width = (decls["outline-width"] ?? "").toLowerCase();
  return /(^|\s)(none|0|0px)(\s|$)/.test(o) || style === "none" || style === "hidden" || width === "0" || width === "0px";
}

function providesIndicator(decls: Record<string, string>): boolean {
  const o = (decls.outline ?? "").toLowerCase();
  if (o && !removesOutline(decls)) return true;
  const style = (decls["outline-style"] ?? "").toLowerCase();
  if (style && style !== "none" && style !== "hidden" && !removesOutline(decls)) return true;
  return COMPENSATING.some((p) => {
    const v = (decls[p] ?? "").toLowerCase();
    return v !== "" && v !== "none" && v !== "0" && v !== "transparent" && v !== "inherit" && v !== "initial";
  });
}

function isFocusRule(rule: CssRule): boolean {
  const last = rule.selector.parts[rule.selector.parts.length - 1].compound;
  return last.states.some((s) => FOCUS_STATES.includes(s));
}

/**
 * 2.4.7: heuristics over the cascade. (a) :focus/:focus-visible rules that remove the outline without a replacement;
 * (b) interactive elements whose base styles remove the outline while no focus rule supplies an indicator.
 */
export const focusVisibleRule: Rule = {
  category: "focus-visible",
  run({ page, resolver }) {
    const out: RawFinding[] = [];
    if (!page.stylesLoaded) return out;
    const focusRules = page.rules.filter(isFocusRule);
    const seenRules = new Set<string>();
    for (const rule of focusRules) {
      if (!removesOutline(rule.decls) || providesIndicator(rule.decls)) continue;
      // Only meaningful when the rule can match something on this page.
      const matches = page.elements.some((el) => matchesSelector(page, el.idx, rule.selector));
      if (!matches || seenRules.has(rule.selector.raw)) continue;
      const covered = focusRules.some((other) => other !== rule && other.selector.raw === rule.selector.raw && providesIndicator(other.decls));
      if (covered) continue;
      seenRules.add(rule.selector.raw);
      out.push({
        ruleId: "focus-visible-removed",
        message: `The rule "${rule.selector.raw}" removes the focus outline without adding another visible indicator.`,
        selector: rule.selector.raw,
        snippet: rule.text.length > 200 ? `${rule.text.slice(0, 196)}...}` : rule.text,
        details: { rule: rule.text },
      });
    }
    for (const el of page.elements) {
      const r = role(el);
      const interactive =
        (el.tag === "a" && el.attrs.href !== undefined) || el.tag === "button" || el.tag === "select" || el.tag === "textarea" || el.tag === "summary" ||
        (el.tag === "input" && (el.attrs.type ?? "").toLowerCase() !== "hidden") || r === "button" || r === "link" || (el.attrs.tabindex !== undefined && Number(el.attrs.tabindex) >= 0);
      if (!interactive || !isVisible(page, el.idx) || resolver.isDisplayNone(el.idx)) continue;
      if (!removesOutline(Object.fromEntries(resolver.declared(el.idx)))) continue;
      const focusMatches = focusRules.filter((rule) => matchesSelector(page, el.idx, rule.selector));
      if (focusMatches.some((rule) => providesIndicator(rule.decls))) continue;
      if (focusMatches.some((rule) => seenRules.has(rule.selector.raw))) continue;
      out.push(makeFinding(page, el.idx, "focus-visible-removed", "Interactive element has outline: none in its base styles and no :focus or :focus-visible rule provides a replacement indicator."));
    }
    return out;
  },
};
