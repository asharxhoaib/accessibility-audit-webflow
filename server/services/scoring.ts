import { Impact } from "../../shared/types";

const WEIGHT: Record<Impact, number> = { critical: 10, serious: 6, moderate: 3, minor: 1 };
const RULE_CAP = 30;

/**
 * Page score 0-100. Each rule contributes weight * (1 + log2(count)), capped, so a single repeated
 * issue hurts but cannot zero the score on its own.
 */
export function scorePage(findings: Array<{ ruleId: string; impact: Impact }>): number {
  const perRule = new Map<string, { impact: Impact; count: number }>();
  for (const f of findings) {
    const e = perRule.get(f.ruleId);
    if (e) e.count++;
    else perRule.set(f.ruleId, { impact: f.impact, count: 1 });
  }
  let penalty = 0;
  for (const { impact, count } of perRule.values()) penalty += Math.min(RULE_CAP, WEIGHT[impact] * (1 + Math.log2(count)));
  return Math.max(0, Math.round(100 - penalty));
}

export function siteScore(pageScores: number[]): number | null {
  if (pageScores.length === 0) return null;
  return Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length);
}
