import { Router } from "express";
import { FINDING_LIST_MAX, WcagLevel } from "../../shared/types";
import { isAuditRunning, rescanPage, startAudit } from "../services/audit";
import { siteOf } from "../services/auth";
import { asyncHandler, HttpError, intParam, strParam } from "../services/errors";
import { getFinding, getRun, ignoreFinding, latestRun, listFindings, listIgnores, listPageResults, listRuns, markFixApplied, overview, resolveRunId, unignoreFinding } from "../services/findings";
import { buildCsv, buildHtmlReport } from "../services/report";
import { getSettings, updateSettings } from "../services/settings";
import { allRuleMeta } from "../services/wcag";

// App Panel API. Mounted under /api behind requireSite.
const router = Router();

function optRunId(q: unknown): number | undefined {
  return q === undefined || q === "" ? undefined : intParam(q, "runId");
}

router.get("/overview", (_req, res) => {
  const siteId = siteOf(res);
  res.json(overview(siteId, isAuditRunning(siteId)));
});

router.get("/rules", (_req, res) => {
  res.json({ rules: allRuleMeta() });
});

router.post("/audit", (_req, res) => {
  const runId = startAudit(siteOf(res), "manual");
  res.status(202).json({ runId });
});

router.get("/runs", (req, res) => {
  const limit = Math.min(100, Math.max(1, req.query.limit ? intParam(req.query.limit, "limit") : 30));
  res.json({ runs: listRuns(siteOf(res), limit) });
});

router.get("/runs/:id", (req, res) => {
  res.json(getRun(siteOf(res), intParam(req.params.id, "id")));
});

router.get("/pages", (req, res) => {
  const siteId = siteOf(res);
  const runId = resolveRunId(siteId, optRunId(req.query.runId));
  res.json({ runId, pages: listPageResults(siteId, runId) });
});

router.post("/pages/:pageId/rescan", asyncHandler(async (req, res) => {
  const siteId = siteOf(res);
  const run = latestRun(siteId);
  if (!run || run.status !== "completed") throw new HttpError(409, "Run a full audit first");
  await rescanPage(siteId, strParam(req.params.pageId, "pageId"), run.id);
  res.json({ ok: true, run: getRun(siteId, run.id) });
}));

router.get("/findings", (req, res) => {
  const siteId = siteOf(res);
  const runId = resolveRunId(siteId, optRunId(req.query.runId));
  const sev = req.query.severity;
  if (sev !== undefined && sev !== "" && sev !== "A" && sev !== "AA" && sev !== "AAA") throw new HttpError(400, "severity must be A, AA or AAA");
  const ig = req.query.ignored;
  if (ig !== undefined && ig !== "" && ig !== "only" && ig !== "include" && ig !== "exclude") throw new HttpError(400, "ignored must be only, include or exclude");
  res.json(
    listFindings(siteId, {
      runId,
      pageId: typeof req.query.pageId === "string" && req.query.pageId ? req.query.pageId : undefined,
      ruleId: typeof req.query.ruleId === "string" && req.query.ruleId ? req.query.ruleId : undefined,
      severity: sev ? (sev as WcagLevel) : undefined,
      ignored: ig ? (ig as "only" | "include" | "exclude") : undefined,
      limit: Math.min(FINDING_LIST_MAX, Math.max(1, req.query.limit ? intParam(req.query.limit, "limit") : 50)),
      offset: Math.max(0, req.query.offset ? intParam(req.query.offset, "offset") : 0),
    })
  );
});

router.get("/findings/:id", (req, res) => {
  res.json(getFinding(siteOf(res), intParam(req.params.id, "id")));
});

router.post("/findings/:id/ignore", (req, res) => {
  res.json(ignoreFinding(siteOf(res), intParam(req.params.id, "id"), typeof req.body?.reason === "string" ? req.body.reason : ""));
});

router.delete("/findings/:id/ignore", (req, res) => {
  res.json(unignoreFinding(siteOf(res), intParam(req.params.id, "id")));
});

router.post("/findings/:id/fix-applied", (req, res) => {
  res.json(markFixApplied(siteOf(res), intParam(req.params.id, "id")));
});

router.get("/ignores", (_req, res) => {
  res.json({ ignores: listIgnores(siteOf(res)) });
});

router.get("/settings", (_req, res) => {
  res.json(getSettings(siteOf(res)));
});

router.put("/settings", (req, res) => {
  res.json(updateSettings(siteOf(res), req.body ?? {}));
});

router.get("/report", asyncHandler(async (req, res) => {
  const siteId = siteOf(res);
  const runId = resolveRunId(siteId, optRunId(req.query.runId));
  const format = req.query.format === "csv" ? "csv" : "html";
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="accessibility-report-run-${runId}.csv"`);
    return void res.send(buildCsv(siteId, runId));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="accessibility-statement-run-${runId}.html"`);
  res.send(await buildHtmlReport(siteId, runId));
}));

export default router;
