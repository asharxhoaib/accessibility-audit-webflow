import { WcagLevel } from "../../shared/types";
import { db } from "../db";
import { getRun, listIgnores, listPageResults } from "./findings";
import { getSettings } from "./settings";
import { CRITERIA, ruleMeta } from "./wcag";
import { getClient } from "./webflow-client";

interface ReportFinding {
  page_id: string;
  path: string | null;
  rule_id: string;
  severity: WcagLevel;
  impact: string;
  selector: string;
  snippet: string;
  message: string;
  ignored: number;
  reason: string | null;
}

function loadFindings(siteId: string, runId: number): ReportFinding[] {
  return db.all<ReportFinding>(
    `SELECT f.page_id, p.path AS path, f.rule_id, f.severity, f.impact, f.selector, f.snippet, f.message, f.ignored, i.reason AS reason
     FROM findings f
     LEFT JOIN page_results p ON p.run_id = f.run_id AND p.page_id = f.page_id
     LEFT JOIN ignores i ON i.site_id = f.site_id AND i.fingerprint = f.fingerprint
     WHERE f.site_id = ? AND f.run_id = ?
     ORDER BY CASE f.impact WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END, p.path, f.id`,
    [siteId, runId]
  );
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(siteId: string, runId: number): string {
  getRun(siteId, runId);
  const header = ["page_path", "rule", "wcag_criterion", "criterion_name", "severity_level", "impact", "status", "ignore_reason", "message", "selector", "html_snippet", "remediation"];
  const lines = [header.join(",")];
  for (const f of loadFindings(siteId, runId)) {
    const m = ruleMeta(f.rule_id);
    lines.push(
      [f.path ?? "", f.rule_id, m.criterion, m.criterionName, f.severity, f.impact, f.ignored ? "ignored" : "open", f.reason ?? "", f.message, f.selector, f.snippet, m.remediation].map(csvCell).join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function buildHtmlReport(siteId: string, runId: number): Promise<string> {
  const run = getRun(siteId, runId);
  const settings = getSettings(siteId);
  let siteName = siteId;
  try {
    siteName = (await getClient(siteId).getSite()).displayName || siteId;
  } catch {
    /* fall back to the id */
  }
  const org = settings.statementOrg || siteName;
  const findings = loadFindings(siteId, runId);
  const open = findings.filter((f) => !f.ignored);
  const exceptions = findings.filter((f) => f.ignored);
  const blocking = open.filter((f) => f.severity === "A" || f.severity === "AA");
  const pages = listPageResults(siteId, runId);
  const date = (run.finishedAt ?? run.startedAt).slice(0, 10);

  const status = blocking.length === 0
    ? "No WCAG 2.2 Level A or AA failures were detected by the automated checks in this audit."
    : `Partially conforms to WCAG 2.2 Level AA: ${blocking.length} Level A/AA issue${blocking.length === 1 ? "" : "s"} were detected and are being addressed.`;

  const byCriterion = new Map<string, { count: number; pages: Set<string> }>();
  for (const f of open) {
    const c = ruleMeta(f.rule_id).criterion;
    const e = byCriterion.get(c) ?? { count: 0, pages: new Set<string>() };
    e.count++;
    e.pages.add(f.path ?? "");
    byCriterion.set(c, e);
  }
  const criterionRows = [...byCriterion.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([c, e]) => `<tr><td>${esc(c)}</td><td>${esc(CRITERIA[c].name)}</td><td>${esc(CRITERIA[c].level)}</td><td>${e.count}</td><td>${e.pages.size}</td></tr>`)
    .join("");
  const pageRows = pages
    .map((p) => `<tr><td>${esc(p.path)}</td><td>${esc(p.title)}</td><td>${p.score === null ? "not audited" : p.score}</td><td>${p.findingCount}</td></tr>`)
    .join("");
  const issueRows = open
    .slice(0, 500)
    .map((f) => {
      const m = ruleMeta(f.rule_id);
      return `<tr><td>${esc(f.path)}</td><td>${esc(m.criterion)} ${esc(m.criterionName)}</td><td>${esc(f.severity)}</td><td>${esc(f.message)}</td><td><code>${esc(f.selector)}</code></td></tr>`;
    })
    .join("");
  const exceptionRows = exceptions
    .map((f) => `<tr><td>${esc(f.path)}</td><td>${esc(ruleMeta(f.rule_id).criterion)}</td><td>${esc(f.message)}</td><td>${esc(f.reason)}</td></tr>`)
    .join("");
  const contact = settings.statementContact
    ? /^https?:\/\//i.test(settings.statementContact)
      ? `<a href="${esc(settings.statementContact)}">${esc(settings.statementContact)}</a>`
      : `<a href="mailto:${esc(settings.statementContact)}">${esc(settings.statementContact)}</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility statement - ${esc(org)}</title>
<style>
body{font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1f24;background:#fff;max-width:960px;margin:0 auto;padding:24px}
h1{font-size:28px}h2{font-size:20px;margin-top:32px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #d0d5dd;vertical-align:top}
th{background:#f2f4f7}
code{font-size:12px;word-break:break-all}
.score{font-size:40px;font-weight:700}
</style>
</head>
<body>
<main>
<h1>Accessibility statement for ${esc(org)}</h1>
<p>${esc(org)} is committed to making ${esc(siteName)} usable by everyone. The target standard is the Web Content Accessibility Guidelines (WCAG) 2.2, Level AA.</p>
<h2>Conformance status</h2>
<p>${esc(status)}</p>
<p>Site accessibility score: <span class="score">${run.siteScore === null ? "n/a" : run.siteScore}</span> out of 100, across ${pages.filter((p) => p.score !== null).length} audited pages. Open issues: ${open.length}.</p>
<h2>How this was measured</h2>
<p>An automated audit ran on ${esc(date)} (run #${run.id}, trigger: ${esc(run.trigger)}). It checks alternative text, link and button names, heading order, form labels, colour contrast, landmarks, document language, duplicate ids, target size and keyboard focus indicators. Automated testing detects only a portion of possible barriers; manual testing with assistive technology is still required for full conformance claims.</p>
<h2>Results by success criterion</h2>
${criterionRows ? `<table><thead><tr><th>Criterion</th><th>Name</th><th>Level</th><th>Issues</th><th>Pages</th></tr></thead><tbody>${criterionRows}</tbody></table>` : "<p>No open issues.</p>"}
<h2>Pages</h2>
<table><thead><tr><th>Path</th><th>Title</th><th>Score</th><th>Open issues</th></tr></thead><tbody>${pageRows}</tbody></table>
<h2>Known issues</h2>
${issueRows ? `<table><thead><tr><th>Page</th><th>Criterion</th><th>Level</th><th>Issue</th><th>Element</th></tr></thead><tbody>${issueRows}</tbody></table>${open.length > 500 ? `<p>Showing the first 500 of ${open.length} issues. The CSV export lists all of them.</p>` : ""}` : "<p>No open issues were detected.</p>"}
${exceptionRows ? `<h2>Reviewed and accepted (false positives and exceptions)</h2><table><thead><tr><th>Page</th><th>Criterion</th><th>Finding</th><th>Reason</th></tr></thead><tbody>${exceptionRows}</tbody></table>` : ""}
${contact ? `<h2>Feedback</h2><p>If you encounter an accessibility barrier on this site, contact us: ${contact}.</p>` : ""}
<p><small>Generated ${esc(new Date().toISOString().slice(0, 10))} by accessibility-audit-webflow. ${listIgnores(siteId).length} reviewed exceptions are on record for this site.</small></p>
</main>
</body>
</html>`;
}
