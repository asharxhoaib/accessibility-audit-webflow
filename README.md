# accessibility-audit-webflow

A Webflow App that audits a site's pages for WCAG 2.2 accessibility issues and guides fixes inside the Designer. It ingests page content through the Pages DOM endpoints and the published HTML, runs a rule engine (one file per category), maps findings to WCAG success criteria, scores pages and the site, keeps trend history and per-run findings, supports an ignore/false-positive workflow with a reason, and exports an HTML accessibility statement and a CSV report.

Stack: Node.js 20, TypeScript, Express, better-sqlite3 behind a `DbAdapter`, hand-rolled Webflow Data API v2 client (no SDK), vanilla TypeScript Designer Extension bundled with esbuild.

## Layout

```
server/
  routes/                      oauth, webhooks, panel (App Panel API)
  services/webflow-client.ts   typed fetch wrapper: token bucket, refresh-on-401, 429 backoff
  services/page-content.ts     Pages DOM + published-HTML ingestion, stylesheet fetch, node-id mapping
  services/dom/                HTML parser, CSS parser/selector matcher, style resolver, colour + contrast math
  services/rules/              one file per category: alt-text, empty-controls, heading-order, form-labels,
                               color-contrast, landmarks, document-language, duplicate-ids, tap-targets, focus-visible
  services/wcag.ts             rule -> WCAG 2.2 criterion, level (A/AA/AAA), impact, remediation text
  services/scoring.ts          page and site score
  services/audit.ts            run orchestration, single-page rescan, publish-debounced audits, retention
  services/findings.ts         persisted findings, ignore workflow, overview + trend queries
  services/report.ts           HTML accessibility statement and CSV export
  services/token-store.ts      encrypted token storage interface (AES-256-GCM)
designer-extension/            App Panel (src/panel.ts, index.html, panel.css, esbuild.config.mjs, webflow.json)
shared/                        types.ts, webflow-types.ts
db/schema.sql                  SQLite-shaped schema
```

## OAuth scopes

| Scope | Why |
| --- | --- |
| `pages:read` | List pages and read static content through the Pages DOM endpoint |
| `pages:write` | Reserved for Designer-side fixes performed by the signed-in designer (the App Panel applies fixes through the Designer API); also lets the app read page metadata for single-page rescans |
| `cms:read` | Resolve a live CMS item so collection template pages can be audited at a real URL |
| `sites:read` | Resolve authorized sites, short name and custom domains (where the published HTML lives) |
| `assets:read` | Read library alt text and file names to map DOM images to published `<img>` tags and avoid false "missing alt" results |

Install flow: `GET /oauth/authorize` (random `state`) -> Webflow -> `GET /oauth/callback` exchanges the code, stores tokens encrypted through the `TokenStore` interface, registers the `site_publish` and `app_uninstalled` webhooks, starts a first audit, then redirects to the App Panel with the site id and a one-time admin token in the URL fragment (only its SHA-256 is stored). On `app_uninstalled` the app purges stored tokens, settings, runs, findings, ignores and webhook registrations.

## Data API endpoints used

| Purpose | Request |
| --- | --- |
| Site + domains | `GET /v2/sites/{siteId}` |
| Pages | `GET /v2/sites/{siteId}/pages?limit=100&offset=0`, `GET /v2/pages/{pageId}` |
| Page content | `GET /v2/pages/{pageId}/dom?limit=100&offset=0` |
| Assets | `GET /v2/sites/{siteId}/assets?limit=100&offset=0` |
| CMS sample item | `GET /v2/collections/{collectionId}/items/live?limit=1` (also `GET /v2/sites/{siteId}/collections`) |
| Webhooks | `POST /v2/sites/{siteId}/webhooks`, `GET` same path, `DELETE /v2/webhooks/{webhookId}` |

Example requests:

```http
GET /v2/pages/{pageId}/dom?limit=100&offset=0
Authorization: Bearer <token>

GET /v2/collections/{collectionId}/items/live?limit=1&offset=0

POST /v2/sites/{siteId}/webhooks
{"triggerType":"site_publish","url":"https://<host>/webhooks/{siteId}/site-publish"}
```

The published HTML and linked stylesheets are fetched directly (not through the Data API) from the site's custom domains and `*.webflow.io`; only those hosts and Webflow's CDN hosts are allowed, and responses are size-limited.

## Rules and WCAG mapping

| Rule id(s) | Criterion | Level |
| --- | --- | --- |
| `missing-alt`, `alt-quality` | 1.1.1 Non-text Content | A |
| `empty-link` | 2.4.4 Link Purpose (In Context) | A |
| `empty-button` | 4.1.2 Name, Role, Value | A |
| `heading-skip`, `heading-no-h1`, `heading-multiple-h1` | 1.3.1 Info and Relationships | A |
| `heading-empty` | 2.4.6 Headings and Labels | AA |
| `form-label` | 3.3.2 Labels or Instructions | A |
| `color-contrast` | 1.4.3 Contrast (Minimum) | AA |
| `color-contrast-enhanced` (opt-in) | 1.4.6 Contrast (Enhanced) | AAA |
| `landmark-main` | 2.4.1 Bypass Blocks | A |
| `landmark-*` others | 1.3.1 | A |
| `html-lang-missing`, `html-lang-invalid` | 3.1.1 Language of Page | A |
| `duplicate-id` | 1.3.1 (4.1.1 is obsolete in WCAG 2.2) | A |
| `tap-target-size` | 2.5.8 Target Size (Minimum) | AA |
| `focus-visible-removed` | 2.4.7 Focus Visible | AA |

Each finding carries the level as its severity (A/AA/AAA), an impact (critical/serious/moderate/minor) used for scoring, and remediation text. Contrast is computed from resolved style tokens: the CSS cascade (classes, inline styles, `var()` custom properties, shorthands) yields text and backdrop colours, semi-transparent layers are composited, and the WCAG relative-luminance ratio is compared against 4.5:1 (3:1 for large text). Backgrounds with images or gradients are skipped rather than guessed. Tap-target and focus-visible checks are heuristics over the cascade and only report when the evidence is clear. At-rules such as `@media` are not evaluated, so the audit reflects the base cascade.

## Scoring, trend, ignore workflow

- Page score = 100 minus per-rule penalties (`impact weight * (1 + log2(count))`, capped per rule). Site score is the mean of audited page scores. Ignored findings are excluded.
- Every run is stored (`audit_runs`, `page_results`, `findings`); the panel plots the last 30 completed runs. Old runs beyond `RUN_RETENTION_COUNT` are pruned.
- Ignoring a finding requires a reason and is keyed by a fingerprint (rule + page path + selector + snippet), so it persists across runs. Ignored items are listed as accepted exceptions in the statement and can be restored.

## Designer integration

The App Panel lists findings; "Select in Designer" switches to the page and selects the element (`webflow.setSelectedElement`). One-click fixes: `setAltText` for image findings and `setCustomAttribute("aria-label", ...)` for links, buttons and form fields. After a fix, "Re-scan page" re-audits that page inside the latest run. Note that the audit reads the published site, so a fix appears in results after the site is published.

## Reports

`GET /api/report?format=html` returns an accessibility statement (conformance status, method, results by criterion, page scores, known issues, accepted exceptions, feedback contact). `format=csv` returns every finding with its criterion, level, status and remediation (formula-injection safe). Set the organisation name and contact in the panel's Settings tab.

## Rate-limit strategy

Webflow allows 60 requests/minute per site. Each site has a token bucket (capacity 60, refill 1/s) that all Data API calls pass through. A `429` blocks the whole bucket until `Retry-After` (or exponential backoff 1 s, 2 s, 4 s..., whichever is longer, plus jitter), up to 5 retries. A `401` triggers one refresh-token exchange and retry. `GET` requests also retry twice on 5xx. Published-HTML and CSS fetches are not Data API calls and do not consume the budget; stylesheets are cached per run.

## Local development

1. `cp .env.example .env` and fill `WEBFLOW_CLIENT_ID` / `WEBFLOW_CLIENT_SECRET` from your Webflow App settings.
2. Webflow requires https and a public URL: run your own tunnel (for example `ngrok http 3000`) and set `APP_PUBLIC_URL` and `WEBFLOW_REDIRECT_URI` (`<url>/oauth/callback`) to it, and register the same redirect URI in the Webflow App. This repo does not start a tunnel.
3. `npm install`, `npm run build:extension`, `npm run dev`.
4. Visit `<APP_PUBLIC_URL>/oauth/authorize` to install on a site, then open the App Panel.

Environment variables are documented in `.env.example`.
