// DTOs shared by the server API and the Designer Extension App Panel.

/** WCAG conformance level of the success criterion a finding maps to. This is the finding "severity". */
export type WcagLevel = "A" | "AA" | "AAA";
/** Practical impact, used for score weighting. */
export type Impact = "critical" | "serious" | "moderate" | "minor";
export type RuleCategory =
  | "alt-text"
  | "empty-controls"
  | "heading-order"
  | "form-labels"
  | "color-contrast"
  | "landmarks"
  | "document-language"
  | "duplicate-ids"
  | "tap-targets"
  | "focus-visible";
/** Fix that the Designer API can apply for a finding. */
export type FixKind = "alt-text" | "aria-label";

export interface RuleMetaDto {
  id: string;
  category: RuleCategory;
  criterion: string;
  criterionName: string;
  level: WcagLevel;
  impact: Impact;
  title: string;
  remediation: string;
  helpUrl: string;
  fixKind: FixKind | null;
}

export interface FindingDto {
  id: number;
  runId: number;
  pageId: string;
  pagePath: string;
  pageTitle: string;
  ruleId: string;
  category: RuleCategory;
  criterion: string;
  criterionName: string;
  severity: WcagLevel;
  impact: Impact;
  message: string;
  remediation: string;
  helpUrl: string;
  selector: string;
  snippet: string;
  nodeId: string | null;
  htmlId: string | null;
  fixKind: FixKind | null;
  details: Record<string, unknown>;
  ignored: boolean;
  ignoreReason: string | null;
  fixApplied: boolean;
}

export interface FindingListDto {
  findings: FindingDto[];
  total: number;
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunDto {
  id: number;
  trigger: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  pageCount: number;
  findingCount: number;
  siteScore: number | null;
  error: string | null;
  pagesDone: number;
}

export interface PageResultDto {
  pageId: string;
  title: string;
  path: string;
  url: string;
  source: string;
  score: number | null;
  findingCount: number;
  error: string | null;
}

export interface TrendPointDto {
  runId: number;
  at: string;
  siteScore: number;
  findingCount: number;
}

export interface CriterionCountDto {
  criterion: string;
  criterionName: string;
  level: WcagLevel;
  count: number;
}

export interface OverviewDto {
  running: boolean;
  latest: RunDto | null;
  previousScore: number | null;
  trend: TrendPointDto[];
  bySeverity: Record<WcagLevel, number>;
  byCriterion: CriterionCountDto[];
  ignoredCount: number;
}

export interface IgnoreDto {
  fingerprint: string;
  ruleId: string;
  pagePath: string;
  message: string;
  reason: string;
  createdAt: string;
}

export interface SettingsDto {
  includeAAA: boolean;
  autoAudit: boolean;
  includeDrafts: boolean;
  maxPages: number;
  statementOrg: string;
  statementContact: string;
}

export const FINDING_LIST_MAX = 200;
