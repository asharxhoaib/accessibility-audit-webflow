-- accessibility-audit-webflow: local persistence schema (SQLite dialect; see server/db.ts adapter)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installations (
  site_id           TEXT PRIMARY KEY,
  access_token_enc  TEXT NOT NULL,               -- AES-256-GCM, see services/token-store.ts
  refresh_token_enc TEXT,
  scopes            TEXT NOT NULL,
  admin_token_hash  TEXT NOT NULL DEFAULT '',    -- sha256 of the App Panel admin token
  installed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_registrations (
  site_id            TEXT NOT NULL,
  trigger_type       TEXT NOT NULL,
  webflow_webhook_id TEXT NOT NULL,
  PRIMARY KEY (site_id, trigger_type)
);

CREATE TABLE IF NOT EXISTS site_settings (
  site_id           TEXT PRIMARY KEY,
  include_aaa       INTEGER NOT NULL DEFAULT 0,    -- also report AAA-only checks (e.g. enhanced contrast 7:1)
  auto_audit        INTEGER NOT NULL DEFAULT 1,    -- audit after site_publish and on the daily schedule
  include_drafts    INTEGER NOT NULL DEFAULT 0,    -- audit draft pages through the DOM API only
  max_pages         INTEGER NOT NULL DEFAULT 200 CHECK (max_pages >= 1),
  statement_org     TEXT NOT NULL DEFAULT '',      -- organisation name shown in the accessibility statement
  statement_contact TEXT NOT NULL DEFAULT '',      -- feedback contact shown in the accessibility statement
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       TEXT NOT NULL,
  trigger       TEXT NOT NULL,                     -- manual | schedule | site_publish | install
  status        TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  page_count    INTEGER NOT NULL DEFAULT 0,
  pages_done    INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,        -- open (non-ignored) findings
  site_score    INTEGER,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_site ON audit_runs (site_id, id);

CREATE TABLE IF NOT EXISTS page_results (
  run_id        INTEGER NOT NULL,
  site_id       TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  path          TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',          -- published-html | dom-api | none
  score         INTEGER,
  finding_count INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  PRIMARY KEY (run_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_page_results_site ON page_results (site_id, run_id);

CREATE TABLE IF NOT EXISTS findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL,
  site_id        TEXT NOT NULL,
  page_id        TEXT NOT NULL,
  rule_id        TEXT NOT NULL,
  criterion      TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('A','AA','AAA')),
  impact         TEXT NOT NULL CHECK (impact IN ('critical','serious','moderate','minor')),
  fingerprint    TEXT NOT NULL,                    -- stable across runs: rule + page path + selector + snippet
  node_id        TEXT,                             -- Webflow Designer element id when known
  html_id        TEXT,
  selector       TEXT NOT NULL DEFAULT '',
  snippet        TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL,
  details_json   TEXT NOT NULL DEFAULT '{}',
  ignored        INTEGER NOT NULL DEFAULT 0,
  fix_applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings (site_id, run_id, page_id);
CREATE INDEX IF NOT EXISTS idx_findings_fp ON findings (site_id, fingerprint);

CREATE TABLE IF NOT EXISTS ignores (
  site_id     TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  page_path   TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, fingerprint)
);
