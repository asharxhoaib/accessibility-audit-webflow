import crypto from "crypto";
import { config } from "../config";
import { db } from "../db";
import { WebflowPage } from "../../shared/webflow-types";
import { HttpError } from "./errors";
import { getRun, recomputeRun } from "./findings";
import { buildPageModel, buildSiteContext, SiteContext } from "./page-content";
import { runRules } from "./rules";
import { getSettings } from "./settings";
import { ruleMeta } from "./wcag";
import { getClient } from "./webflow-client";

const running = new Set<string>();

export function isAuditRunning(siteId: string): boolean {
  return running.has(siteId);
}

function fingerprint(ruleId: string, path: string, selector: string, snippet: string): string {
  return crypto.createHash("sha1").update([ruleId, path, selector, snippet].join("\u0001")).digest("hex");
}

function ignoredSet(siteId: string): Set<string> {
  return new Set(db.all<{ fingerprint: string }>(`SELECT fingerprint FROM ignores WHERE site_id = ?`, [siteId]).map((r) => r.fingerprint));
}

/** Audits one page and persists page_results + findings (replacing any rows already stored for that page in the run). */
async function auditPage(siteId: string, runId: number, ctx: SiteContext, page: WebflowPage, includeAAA: boolean, includeDrafts: boolean, ignored: Set<string>): Promise<void> {
  const built = await buildPageModel(ctx, page, includeDrafts);
  const path = page.publishedPath ?? `/${page.slug}`;
  let error = built.error;
  const rows: Array<Array<string | number | null>> = [];
  if (built.model) {
    const result = runRules(built.model, includeAAA);
    if (result.ruleErrors.length) error = [error, ...result.ruleErrors].filter(Boolean).join(" | ");
    for (const f of result.findings) {
      const meta = ruleMeta(f.ruleId);
      const fp = fingerprint(f.ruleId, path, f.selector, f.snippet);
      rows.push([runId, siteId, page.id, f.ruleId, meta.criterion, meta.level, f.impact ?? meta.impact, fp, f.nodeId ?? null, f.htmlId ?? null, f.selector, f.snippet, f.message, JSON.stringify(f.details ?? {}), ignored.has(fp) ? 1 : 0]);
    }
  }
  db.transaction(() => {
    db.run(`DELETE FROM findings WHERE run_id = ? AND site_id = ? AND page_id = ?`, [runId, siteId, page.id]);
    db.run(`DELETE FROM page_results WHERE run_id = ? AND site_id = ? AND page_id = ?`, [runId, siteId, page.id]);
    db.run(`INSERT INTO page_results (run_id, site_id, page_id, title, path, url, source, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [runId, siteId, page.id, page.title, path, built.url, built.source, error]);
    for (const r of rows) {
      db.run(
        `INSERT INTO findings (run_id, site_id, page_id, rule_id, criterion, severity, impact, fingerprint, node_id, html_id, selector, snippet, message, details_json, ignored)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r
      );
    }
  });
}

async function prepare(siteId: string): Promise<SiteContext> {
  const client = getClient(siteId);
  const site = await client.getSite();
  let assets: Awaited<ReturnType<typeof client.listAssets>> = [];
  try {
    assets = await client.listAssets();
  } catch {
    assets = [];
  }
  return buildSiteContext(client, site, assets);
}

async function executeRun(siteId: string, runId: number): Promise<void> {
  try {
    const settings = getSettings(siteId);
    const ctx = await prepare(siteId);
    const all = await ctx.client.listAllPages();
    const limit = Math.min(settings.maxPages, config.audit.maxPagesPerRun);
    const pages = all.filter((p) => !p.archived).slice(0, limit);
    db.run(`UPDATE audit_runs SET page_count = ? WHERE id = ?`, [pages.length, runId]);
    const ignored = ignoredSet(siteId);
    let done = 0;
    for (const page of pages) {
      await auditPage(siteId, runId, ctx, page, settings.includeAAA, settings.includeDrafts, ignored);
      done++;
      db.run(`UPDATE audit_runs SET pages_done = ? WHERE id = ?`, [done, runId]);
    }
    recomputeRun(siteId, runId);
    db.run(`UPDATE audit_runs SET status = 'completed', finished_at = datetime('now') WHERE id = ?`, [runId]);
    pruneRuns(siteId);
  } catch (err) {
    db.run(`UPDATE audit_runs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?`, [err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500), runId]);
  } finally {
    running.delete(siteId);
  }
}

/** Starts an audit in the background and returns the run id. One run per site at a time. */
export function startAudit(siteId: string, trigger: "manual" | "schedule" | "site_publish" | "install"): number {
  if (running.has(siteId)) throw new HttpError(409, "An audit is already running for this site");
  running.add(siteId);
  const r = db.run(`INSERT INTO audit_runs (site_id, trigger, status) VALUES (?, ?, 'running')`, [siteId, trigger]);
  const runId = Number(r.lastInsertRowid);
  setImmediate(() => {
    executeRun(siteId, runId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[audit] run ${runId} crashed:`, err);
    });
  });
  return runId;
}

/** Re-audits a single page inside the latest completed run (used after applying a fix in the Designer). */
export async function rescanPage(siteId: string, pageId: string, runId: number): Promise<void> {
  const run = getRun(siteId, runId);
  if (run.status !== "completed") throw new HttpError(409, "Run is not completed");
  if (running.has(siteId)) throw new HttpError(409, "An audit is already running for this site");
  const settings = getSettings(siteId);
  const ctx = await prepare(siteId);
  const page = await ctx.client.getPage(pageId);
  await auditPage(siteId, runId, ctx, page, settings.includeAAA, settings.includeDrafts, ignoredSet(siteId));
  recomputeRun(siteId, runId);
}

/** Deletes runs (and their findings) beyond the retention count. */
export function pruneRuns(siteId: string): void {
  const old = db.all<{ id: number }>(`SELECT id FROM audit_runs WHERE site_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?`, [siteId, config.audit.runRetentionCount]);
  if (old.length === 0) return;
  db.transaction(() => {
    for (const { id } of old) {
      db.run(`DELETE FROM findings WHERE run_id = ? AND site_id = ?`, [id, siteId]);
      db.run(`DELETE FROM page_results WHERE run_id = ? AND site_id = ?`, [id, siteId]);
      db.run(`DELETE FROM audit_runs WHERE id = ? AND site_id = ?`, [id, siteId]);
    }
  });
}

/** Called at boot: runs left in "running" by a crashed process would otherwise block the site forever. */
export function failStaleRuns(): void {
  db.run(`UPDATE audit_runs SET status = 'failed', finished_at = datetime('now'), error = 'Server restarted during the run' WHERE status = 'running'`);
}

const publishTimers = new Map<string, NodeJS.Timeout>();

/** Debounced audit after a site_publish webhook. */
export function schedulePublishAudit(siteId: string): void {
  if (!getSettings(siteId).autoAudit) return;
  const existing = publishTimers.get(siteId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    publishTimers.delete(siteId);
    if (running.has(siteId)) return;
    try {
      startAudit(siteId, "site_publish");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[audit] publish-triggered audit failed for ${siteId}:`, err);
    }
  }, config.audit.publishDelaySec * 1000);
  t.unref();
  publishTimers.set(siteId, t);
}

export function cancelPublishAudit(siteId: string): void {
  const t = publishTimers.get(siteId);
  if (t) clearTimeout(t);
  publishTimers.delete(siteId);
}

export function sitesDueForAudit(): string[] {
  const rows = db.all<{ site_id: string; last: string | null }>(
    `SELECT s.site_id AS site_id, (SELECT MAX(started_at) FROM audit_runs r WHERE r.site_id = s.site_id) AS last
     FROM site_settings s JOIN installations i ON i.site_id = s.site_id WHERE s.auto_audit = 1`
  );
  const cutoff = Date.now() - config.audit.autoAuditEveryHours * 3600000;
  return rows.filter((r) => !r.last || Date.parse(`${r.last.replace(" ", "T")}Z`) < cutoff).map((r) => r.site_id);
}
