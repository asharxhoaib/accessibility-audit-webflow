import { PageModel } from "../dom/model";
import { StyleResolver } from "../dom/style-resolver";
import { ruleMeta } from "../wcag";
import { altTextRule } from "./alt-text";
import { colorContrastRule } from "./color-contrast";
import { documentLanguageRule } from "./document-language";
import { duplicateIdsRule } from "./duplicate-ids";
import { emptyControlsRule } from "./empty-controls";
import { focusVisibleRule } from "./focus-visible";
import { formLabelsRule } from "./form-labels";
import { headingOrderRule } from "./heading-order";
import { landmarksRule } from "./landmarks";
import { tapTargetsRule } from "./tap-targets";
import { RawFinding, Rule } from "./types";

export const ALL_RULES: Rule[] = [
  altTextRule,
  emptyControlsRule,
  headingOrderRule,
  formLabelsRule,
  colorContrastRule,
  landmarksRule,
  documentLanguageRule,
  duplicateIdsRule,
  tapTargetsRule,
  focusVisibleRule,
];

/** Cap per rule per page so one shared component cannot bury the report. */
const MAX_PER_RULE_PER_PAGE = 100;

export interface RuleRunResult {
  findings: RawFinding[];
  ruleErrors: string[];
}

export function runRules(page: PageModel, includeAAA: boolean): RuleRunResult {
  const resolver = new StyleResolver(page);
  const findings: RawFinding[] = [];
  const ruleErrors: string[] = [];
  const perRule = new Map<string, number>();
  for (const rule of ALL_RULES) {
    try {
      for (const f of rule.run({ page, resolver, includeAAA })) {
        ruleMeta(f.ruleId);
        const n = perRule.get(f.ruleId) ?? 0;
        if (n >= MAX_PER_RULE_PER_PAGE) continue;
        perRule.set(f.ruleId, n + 1);
        findings.push(f);
      }
    } catch (err) {
      ruleErrors.push(`${rule.category}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { findings, ruleErrors };
}
