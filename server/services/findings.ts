import { CriterionCountDto, FindingDto, FindingListDto, IgnoreDto, OverviewDto, PageResultDto, RunDto, RunStatus, TrendPointDto, WcagLevel, FixKind, Impact, RuleCategory } from "../../shared/types";
import { db } from "../db";
import { HttpError } from "./errors";
import { scorePage, siteScore } from "./scoring";
import { CRITERIA, ruleMeta } from "./wcag";

interface RunRow {
  id: number;
  trigger: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  page_count: number;
  pages_done: number;
  finding_count: number;
  site_score: number | null;
  error: string | null;
}

export function toRunDto(r: RunRow): RunDto {
  return { id: r.id, trigger: r.trigger, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, pageCount: r.page_count, pagesDone: r.pages_done, findingCount: r.finding_count, siteScore: r.site_score, error: r.error };
}

export function getRun(siteId: string, runId: number): RunDto {
  const r = db.get<RunRow>(`SELECT * FROM audit_runs WHERE site_id = ? AND id = ?`, [siteId, runId]);
  if (!r) throw new HttpError(404, "Run not found");
  return toRunDto(r);
}

export function listRuns(siteId: string, limit = 30): RunDto[] {
  return db.all<RunRow>(`SELECT * FROM audit_runs WHERE site_id = ? ORDER BY id DESC LIMIT ?`, [siteId, limit]).map(toRunDto);
}

/** Latest completed run, or the running one if none has completed yet. */
export function latestRun(siteId: string): RunDto | null {
  const done = db.get<RunRow>(`SELECT * FROM audit_runs WHERE site_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`, [siteId]);
  if (done) return toRunDto(done);
  const any = db.get<RunRow>(`SELECT * FROM audit_runs WHERE site_id = ? ORDER BY id DESC LIMIT 1`, [siteId]);
  return any ? toRunDto(any) : null;
}

export function resolveRunId(siteId: string, requested?: number): number {
  if (requested !== undefined) {
    getRun(siteId, requested);
    return requested;
  }
  const r = latestRun(siteId);
  if (!r) throw new HttpError(404, "No audit has been run yet");
  return r.id;
}

/** Recomputes page scores, finding counts and the site score of a run from its non-ignored findings. */
export function recomputeRun(siteId: string, runId: number): void {
  db.transaction(() => {
    const pages = db.all<{ page_id: string; error: string | null; source: string }>(`SELECT page_id, error, source FROM page_results WHERE run_id = ? AND site_id = ?`, [runId, siteId]);
    const scores: number[] = [];
    let open = 0;
    for (const p of pages) {
      const rows = db.all<{ rule_id: string; impact: Impact }>(`SELECT rule_id, impact FROM findings WHERE run_id = ? AND site_id = ? AND page_id = ? AND ignored = 0`, [runId, siteId, p.page_id]);
      open += rows.length;
      if (p.source === "none") {
        db.run(`UPDATE page_results SET score = NULL, finding_count = 0 WHERE run_id = ? AND page_id = ?`, [runId, p.page_id]);
        continue;
      }
      const score = scorePage(rows.map((r) => ({ ruleId: r.rule_id, impact: r.impact })));
      scores.push(score);
      db.run(`UPDATE page_results SET score = ?, finding_count = ? WHERE run_id = ? AND page_id = ?`, [score, rows.length, runId, p.page_id]);
    }
    db.run(`UPDATE audit_runs SET site_score = ?, finding_count = ? WHERE id = ? AND site_id = ?`, [siteScore(scores), open, runId, siteId]);
  });
}

export function listPageResults(siteId: string, runId: number): PageResultDto[] {
  return db
    .all<{ page_id: string; title: string; path: string; url: string; source: string; score: number | null; finding_count: number; error: string | null }>(
      `SELECT page_id, title, path, url, source, score, finding_count, error FROM page_results WHERE site_id = ? AND run_id = ? ORDER BY (score IS NULL), score ASC, path ASC`,
      [siteId, runId]
    )
    .map((p) => ({ pageId: p.page_id, title: p.title, path: p.path, url: p.url, source: p.source, score: p.score, findingCount: p.finding_count, error: p.error }));
}

interface FindingRow {
  id: number;
  run_id: number;
  page_id: string;
  rule_id: string;
  severity: WcagLevel;
  impact: Impact;
  node_id: string | null;
  html_id: string | null;
  selector: string;
  snippet: string;
  message: string;
  details_json: string;
  ignored: number;
  fix_applied_at: string | null;
  path: string | null;
  title: string | null;
  reason: string | null;
}

const FINDING_SELECT = `SELECT f.id, f.run_id, f.page_id, f.rule_id, f.severity, f.impact, f.node_id, f.html_id, f.selector, f.snippet, f.message, f.details_json, f.ignored, f.fix_applied_at,
    p.path AS path, p.title AS title, i.reason AS reason
  FROM findings f
  LEFT JOIN page_results p ON p.run_id = f.run_id AND p.page_id = f.page_id
  LEFT JOIN ignores i ON i.site_id = f.site_id AND i.fingerprint = f.fingerprint`;

export function toFindingDto(r: FindingRow): FindingDto {
  const m = ruleMeta(r.rule_id);
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(r.details_json) as Record<string, unknown>;
  } catch {
    details = {};
  }
  return {
    id: r.id,
    runId: r.run_id,
    pageId: r.page_id,
    pagePath: r.path ?? "",
    pageTitle: r.title ?? "",
    ruleId: r.rule_id,
    category: m.category as RuleCategory,
    criterion: m.criterion,
    criterionName: m.criterionName,
    severity: r.severity,
    impact: r.impact,
    message: r.message,
    remediation: m.remediation,
    helpUrl: m.helpUrl,
    selector: r.selector,
    snippet: r.snippet,
    nodeId: r.node_id,
    htmlId: r.html_id,
    fixKind: (r.node_id ? m.fixKind : null) as FixKind | null,
    details,
    ignored: !!r.ignored,
    ignoreReason: r.reason,
    fixApplied: !!r.fix_applied_at,
  };
}

export interface FindingFilter {
  runId: number;
  pageId?: string;
  ruleId?: string;
  severity?: WcagLevel;
  ignored?: "only" | "include" | "exclude";
  limit: number;
  offset: number;
}

const IMPACT_ORDER = `CASE f.impact WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`;

export function listFindings(siteId: string, f: FindingFilter): FindingListDto {
  const where = [`f.site_id = ?`, `f.run_id = ?`];
  const params: Array<string | number> = [siteId, f.runId];
  if (f.pageId) {
    where.push(`f.page_id = ?`);
    params.push(f.pageId);
  }
  if (f.ruleId) {
    where.push(`f.rule_id = ?`);
    params.push(f.ruleId);
  }
  if (f.severity) {
    where.push(`f.severity = ?`);
    params.push(f.severity);
  }
  if (f.ignored === "only") where.push(`f.ignored = 1`);
  else if (f.ignored !== "include") where.push(`f.ignored = 0`);
  const clause = where.join(" AND ");
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM findings f WHERE ${clause}`, params)?.n ?? 0;
  const rows = db.all<FindingRow>(`${FINDING_SELECT} WHERE ${clause} ORDER BY ${IMPACT_ORDER}, f.id LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
  return { findings: rows.map(toFindingDto), total };
}

export function getFinding(siteId: string, findingId: number): FindingDto {
  const r = db.get<FindingRow>(`${FINDING_SELECT} WHERE f.site_id = ? AND f.id = ?`, [siteId, findingId]);
  if (!r) throw new HttpError(404, "Finding not found");
  return toFindingDto(r);
}

/** Ignore / false-positive workflow: keyed by fingerprint so it survives future runs. A reason is mandatory. */
export function ignoreFinding(siteId: string, findingId: number, reason: string): FindingDto {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new HttpError(400, "A reason of at least 3 characters is required");
  if (trimmed.length > 500) throw new HttpError(400, "Reason must be 500 characters or fewer");
  const row = db.get<{ fingerprint: string; rule_id: string; message: string; run_id: number; path: string | null }>(
    `SELECT f.fingerprint, f.rule_id, f.message, f.run_id, p.path FROM findings f LEFT JOIN page_results p ON p.run_id = f.run_id AND p.page_id = f.page_id WHERE f.site_id = ? AND f.id = ?`,
    [siteId, findingId]
  );
  if (!row) throw new HttpError(404, "Finding not found");
  db.transaction(() => {
    db.run(
      `INSERT INTO ignores (site_id, fingerprint, rule_id, page_path, message, reason) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, fingerprint) DO UPDATE SET reason = excluded.reason`,
      [siteId, row.fingerprint, row.rule_id, row.path ?? "", row.message.slice(0, 300), trimmed]
    );
    db.run(`UPDATE findings SET ignored = 1 WHERE site_id = ? AND fingerprint = ?`, [siteId, row.fingerprint]);
  });
  recomputeRun(siteId, row.run_id);
  return getFinding(siteId, findingId);
}

export function unignoreFinding(siteId: string, findingId: number): FindingDto {
  const row = db.get<{ fingerprint: string; run_id: number }>(`SELECT fingerprint, run_id FROM findings WHERE site_id = ? AND id = ?`, [siteId, findingId]);
  if (!row) throw new HttpError(404, "Finding not found");
  db.transaction(() => {
    db.run(`DELETE FROM ignores WHERE site_id = ? AND fingerprint = ?`, [siteId, row.fingerprint]);
    db.run(`UPDATE findings SET ignored = 0 WHERE site_id = ? AND fingerprint = ?`, [siteId, row.fingerprint]);
  });
  recomputeRun(siteId, row.run_id);
  return getFinding(siteId, findingId);
}

/** Records that a Designer fix was applied; the next audit verifies it. */
export function markFixApplied(siteId: string, findingId: number): FindingDto {
  const r = db.run(`UPDATE findings SET fix_applied_at = datetime('now') WHERE site_id = ? AND id = ?`, [siteId, findingId]);
  if (r.changes === 0) throw new HttpError(404, "Finding not found");
  return getFinding(siteId, findingId);
}

export function listIgnores(siteId: string): IgnoreDto[] {
  return db
    .all<{ fingerprint: string; rule_id: string; page_path: string; message: string; reason: string; created_at: string }>(
      `SELECT fingerprint, rule_id, page_path, message, reason, created_at FROM ignores WHERE site_id = ? ORDER BY created_at DESC`,
      [siteId]
    )
    .map((i) => ({ fingerprint: i.fingerprint, ruleId: i.rule_id, pagePath: i.page_path, message: i.message, reason: i.reason, createdAt: i.created_at }));
}

export function overview(siteId: string, running: boolean): OverviewDto {
  const latest = latestRun(siteId);
  const trendRows = db.all<{ id: number; finished_at: string | null; started_at: string; site_score: number; finding_count: number }>(
    `SELECT id, finished_at, started_at, site_score, finding_count FROM audit_runs WHERE site_id = ? AND status = 'completed' AND site_score IS NOT NULL ORDER BY id DESC LIMIT 30`,
    [siteId]
  ).reverse();
  const trend: TrendPointDto[] = trendRows.map((t) => ({ runId: t.id, at: t.finished_at ?? t.started_at, siteScore: t.site_score, findingCount: t.finding_count }));
  const previousScore = trend.length >= 2 ? trend[trend.length - 2].siteScore : null;
  const bySeverity: Record<WcagLevel, number> = { A: 0, AA: 0, AAA: 0 };
  const byCriterion: CriterionCountDto[] = [];
  let ignoredCount = 0;
  if (latest) {
    for (const r of db.all<{ severity: WcagLevel; n: number }>(`SELECT severity, COUNT(*) AS n FROM findings WHERE site_id = ? AND run_id = ? AND ignored = 0 GROUP BY severity`, [siteId, latest.id])) bySeverity[r.severity] = r.n;
    const byRule = db.all<{ rule_id: string; n: number }>(`SELECT rule_id, COUNT(*) AS n FROM findings WHERE site_id = ? AND run_id = ? AND ignored = 0 GROUP BY rule_id`, [siteId, latest.id]);
    const crit = new Map<string, number>();
    for (const r of byRule) {
      const c = ruleMeta(r.rule_id).criterion;
      crit.set(c, (crit.get(c) ?? 0) + r.n);
    }
    for (const [criterion, count] of [...crit.entries()].sort((a, b) => b[1] - a[1])) {
      byCriterion.push({ criterion, criterionName: CRITERIA[criterion].name, level: CRITERIA[criterion].level, count });
    }
    ignoredCount = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM findings WHERE site_id = ? AND run_id = ? AND ignored = 1`, [siteId, latest.id])?.n ?? 0;
  }
  return { running, latest, previousScore, trend, bySeverity, byCriterion, ignoredCount };
}
