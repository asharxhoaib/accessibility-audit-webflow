import { SettingsDto } from "../../shared/types";
import { db } from "../db";
import { HttpError } from "./errors";

interface SettingsRow {
  include_aaa: number;
  auto_audit: number;
  include_drafts: number;
  max_pages: number;
  statement_org: string;
  statement_contact: string;
}

export function ensureSettings(siteId: string): void {
  db.run(`INSERT OR IGNORE INTO site_settings (site_id) VALUES (?)`, [siteId]);
}

export function getSettings(siteId: string): SettingsDto {
  ensureSettings(siteId);
  const r = db.get<SettingsRow>(`SELECT include_aaa, auto_audit, include_drafts, max_pages, statement_org, statement_contact FROM site_settings WHERE site_id = ?`, [siteId]) as SettingsRow;
  return {
    includeAAA: !!r.include_aaa,
    autoAudit: !!r.auto_audit,
    includeDrafts: !!r.include_drafts,
    maxPages: r.max_pages,
    statementOrg: r.statement_org,
    statementContact: r.statement_contact,
  };
}

export function updateSettings(siteId: string, body: Partial<SettingsDto>): SettingsDto {
  const cur = getSettings(siteId);
  const next: SettingsDto = { ...cur };
  if (body.includeAAA !== undefined) next.includeAAA = !!body.includeAAA;
  if (body.autoAudit !== undefined) next.autoAudit = !!body.autoAudit;
  if (body.includeDrafts !== undefined) next.includeDrafts = !!body.includeDrafts;
  if (body.maxPages !== undefined) {
    const n = Number(body.maxPages);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "maxPages must be an integer between 1 and 1000");
    next.maxPages = n;
  }
  if (body.statementOrg !== undefined) next.statementOrg = String(body.statementOrg).trim().slice(0, 120);
  if (body.statementContact !== undefined) {
    const c = String(body.statementContact).trim().slice(0, 200);
    if (c && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && !/^https?:\/\/\S+$/i.test(c)) throw new HttpError(400, "statementContact must be an email address or an http(s) URL");
    next.statementContact = c;
  }
  db.run(
    `UPDATE site_settings SET include_aaa = ?, auto_audit = ?, include_drafts = ?, max_pages = ?, statement_org = ?, statement_contact = ?, updated_at = datetime('now') WHERE site_id = ?`,
    [next.includeAAA ? 1 : 0, next.autoAudit ? 1 : 0, next.includeDrafts ? 1 : 0, next.maxPages, next.statementOrg, next.statementContact, siteId]
  );
  return next;
}
