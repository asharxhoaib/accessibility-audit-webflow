import type {
  FindingDto,
  FindingListDto,
  IgnoreDto,
  OverviewDto,
  PageResultDto,
  RuleMetaDto,
  RunDto,
  SettingsDto,
} from "../../shared/types";

type Tab = "overview" | "findings" | "pages" | "ignored" | "settings";

interface Creds {
  siteId: string;
  token: string;
}

class ApiFailure extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const view = $<HTMLElement>("view");
let creds: Creds | null = null;
let current: Tab = "overview";
let pollTimer: number | undefined;

interface FindingFilters {
  pageId: string;
  ruleId: string;
  severity: string;
  showIgnored: boolean;
}
const filters: FindingFilters = { pageId: "", ruleId: "", severity: "", showIgnored: false };

// --- DOM helpers (text is always set via textContent, never innerHTML) ---
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (typeof v === "boolean") {
      if (v) el.setAttribute(k, "");
    } else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

function table(headers: string[], rows: Child[][], empty = "Nothing to show."): HTMLElement {
  return h(
    "table",
    {},
    h("thead", {}, h("tr", {}, ...headers.map((t) => h("th", {}, t)))),
    h("tbody", {}, ...(rows.length ? rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c)))) : [h("tr", {}, h("td", { colspan: String(headers.length) }, empty))]))
  );
}

function toast(message: string, error = false): void {
  const el = $<HTMLElement>("toast");
  el.textContent = message;
  el.className = error ? "toast error" : "toast";
  el.hidden = false;
  window.setTimeout(() => (el.hidden = true), 4000);
}

function loadCreds(): Creds | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const fromHash = { siteId: hash.get("site") ?? "", token: hash.get("token") ?? "" };
  try {
    if (fromHash.siteId && fromHash.token) {
      sessionStorage.setItem("aa-creds", JSON.stringify(fromHash));
      history.replaceState(null, "", location.pathname);
      return fromHash;
    }
    const raw = sessionStorage.getItem("aa-creds");
    if (raw) return JSON.parse(raw) as Creds;
  } catch {
    if (fromHash.siteId && fromHash.token) return fromHash;
  }
  return null;
}

function authHeaders(): Record<string, string> {
  if (!creds) throw new ApiFailure(401, "Not connected");
  return { "Content-Type": "application/json", "X-Site-Id": creds.siteId, "X-Admin-Token": creds.token };
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method, headers: authHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiFailure(res.status, json.error || `Request failed (${res.status})`);
  return json as T;
}

async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiFailure(res.status, json.error || `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function guarded(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 401) {
      try {
        sessionStorage.removeItem("aa-creds");
      } catch {
        /* ignore */
      }
      creds = null;
      boot();
    }
    toast(err instanceof Error ? err.message : String(err), true);
  }
}

// --- Designer integration ---
async function findDesignerElement(f: FindingDto): Promise<DesignerElement | null> {
  const all = await webflow.getAllElements();
  const byNode = all.find((e) => e.id.element === f.nodeId);
  if (byNode) return byNode;
  if (f.htmlId) {
    for (const e of all) {
      if (typeof e.getDomId !== "function") continue;
      if ((await e.getDomId()) === f.htmlId) return e;
    }
  }
  return null;
}

async function selectInDesigner(f: FindingDto): Promise<DesignerElement> {
  if (!f.nodeId && !f.htmlId) throw new Error("This finding is not tied to a single Designer element.");
  const page = await webflow.getCurrentPage();
  if (page.id !== f.pageId) {
    const target = (await webflow.getAllPagesAndFolders()).find((p) => p.id === f.pageId);
    if (!target) throw new Error("The page for this finding could not be found in the Designer.");
    await webflow.switchPage(target);
  }
  const el = await findDesignerElement(f);
  if (!el) throw new Error("The element was not found on the page. Re-run the audit; it may have been edited or deleted.");
  await webflow.setSelectedElement(el);
  return el;
}

async function applyFix(f: FindingDto, value: string): Promise<void> {
  const text = value.trim();
  if (!text) throw new Error("Enter the text to apply.");
  const el = await selectInDesigner(f);
  if (f.fixKind === "alt-text") {
    if (typeof el.setAltText !== "function") throw new Error("The selected element does not support alt text. Edit it in Element Settings.");
    await el.setAltText(text);
  } else if (f.fixKind === "aria-label") {
    if (typeof el.setCustomAttribute !== "function") throw new Error("The selected element does not support custom attributes. Add aria-label in Element Settings.");
    await el.setCustomAttribute("aria-label", text);
  } else throw new Error("No one-click fix is available for this finding.");
  await api("POST", `/findings/${f.id}/fix-applied`);
}

// --- views ---
function sparkline(points: number[]): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 200 60");
  svg.setAttribute("class", "spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Score trend: ${points.join(", ")}`);
  if (points.length === 0) return svg;
  const step = points.length > 1 ? 190 / (points.length - 1) : 0;
  const coords = points.map((p, i) => `${5 + i * step},${55 - (p / 100) * 50}`);
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", coords.length === 1 ? `5,${coords[0].split(",")[1]} 195,${coords[0].split(",")[1]}` : coords.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "2");
  svg.append(line);
  return svg;
}

function runProgress(run: RunDto): HTMLElement {
  const pct = run.pageCount > 0 ? Math.round((run.pagesDone / run.pageCount) * 100) : 0;
  const bar = h("div", {});
  bar.style.width = `${pct}%`;
  return h("div", {}, h("p", { class: "muted" }, `Audit running: ${run.pagesDone} of ${run.pageCount || "?"} pages`), h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, bar));
}

function schedulePoll(): void {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => void guarded(async () => renderCurrent()), 2500);
}

async function renderOverview(): Promise<void> {
  const o = await api<OverviewDto>("GET", "/overview");
  const latest = o.latest;
  const score = latest?.siteScore ?? null;
  const delta = score !== null && o.previousScore !== null ? score - o.previousScore : null;
  const runBtn = h("button", { class: "btn primary", onclick: () => void guarded(async () => {
    await api("POST", "/audit");
    toast("Audit started");
    await renderOverview();
  }) }, o.running ? "Audit running" : "Run audit");
  if (o.running) runBtn.setAttribute("disabled", "");

  const csvBtn = h("button", { class: "btn", onclick: () => void guarded(() => download("/report?format=csv", "accessibility-report.csv")) }, "Export CSV");
  const htmlBtn = h("button", { class: "btn", onclick: () => void guarded(() => download("/report?format=html", "accessibility-statement.html")) }, "Export statement (HTML)");
  if (!latest || latest.status !== "completed") {
    csvBtn.setAttribute("disabled", "");
    htmlBtn.setAttribute("disabled", "");
  }

  view.replaceChildren(
    h("section", { class: "card" },
      h("div", { class: "row space" },
        h("h2", {}, "Site score"),
        h("div", { class: "row" }, runBtn, csvBtn, htmlBtn)),
      latest && latest.status === "running" ? runProgress(latest) : null,
      score === null
        ? h("p", { class: "muted" }, latest?.status === "failed" ? `Last audit failed: ${latest.error ?? "unknown error"}` : "No completed audit yet. Run one to see your score.")
        : h("div", { class: "row" },
            h("span", { class: "score" }, String(score)),
            h("span", { class: "muted" }, "out of 100"),
            delta !== null && delta !== 0 ? h("span", { class: `delta ${delta > 0 ? "up" : "down"}` }, `${delta > 0 ? "+" : ""}${delta} since previous run`) : null),
      latest?.finishedAt ? h("p", { class: "muted" }, `Run #${latest.id} finished ${latest.finishedAt} UTC (${latest.trigger}). ${latest.findingCount} open findings across ${latest.pageCount} pages.`) : null,
      o.trend.length ? sparkline(o.trend.map((t) => t.siteScore)) : null),
    h("section", { class: "card" }, h("h2", {}, "Open findings by WCAG level"),
      table(["Level", "Findings"], (["A", "AA", "AAA"] as const).map((l) => [h("span", { class: "tag" }, l), String(o.bySeverity[l])]))),
    h("section", { class: "card" }, h("h2", {}, "By success criterion"),
      table(["Criterion", "Name", "Level", "Findings"], o.byCriterion.map((c) => [c.criterion, c.criterionName, c.level, String(c.count)]), "No open findings."),
      o.ignoredCount ? h("p", { class: "muted" }, `${o.ignoredCount} findings are ignored and excluded from the score.`) : null)
  );
  if (o.running) schedulePoll();
}

function findingCard(f: FindingDto, onChange: () => void): HTMLElement {
  const fixInput = h("input", { placeholder: f.fixKind === "alt-text" ? "Describe the image" : "Accessible name", "aria-label": f.fixKind === "alt-text" ? "Alt text" : "aria-label value" });
  const reasonInput = h("input", { placeholder: "Reason for ignoring (required)", "aria-label": "Ignore reason" });

  const actions = h("div", { class: "row" },
    f.nodeId || f.htmlId ? h("button", { class: "btn small", onclick: () => void guarded(async () => {
      await selectInDesigner(f);
      toast("Element selected in the Designer");
    }) }, "Select in Designer") : null,
    h("a", { href: f.helpUrl, target: "_blank", rel: "noopener noreferrer" }, `WCAG ${f.criterion}`),
    h("button", { class: "btn small", onclick: () => void guarded(async () => {
      await api("POST", `/pages/${encodeURIComponent(f.pageId)}/rescan`);
      toast("Page re-audited");
      onChange();
    }) }, "Re-scan page"));

  const fixBox = f.fixKind && !f.ignored
    ? h("div", { class: "fixbox" }, fixInput,
        h("button", { class: "btn small primary", onclick: () => void guarded(async () => {
          await applyFix(f, (fixInput as HTMLInputElement).value);
          toast(f.fixKind === "alt-text" ? "Alt text applied" : "aria-label applied");
          onChange();
        }) }, f.fixKind === "alt-text" ? "Set alt text" : "Set aria-label"))
    : null;

  const ignoreBox = f.ignored
    ? h("div", { class: "fixbox" }, h("span", { class: "muted" }, `Ignored: ${f.ignoreReason ?? ""}`),
        h("button", { class: "btn small", onclick: () => void guarded(async () => {
          await api("DELETE", `/findings/${f.id}/ignore`);
          onChange();
        }) }, "Restore"))
    : h("div", { class: "fixbox" }, reasonInput,
        h("button", { class: "btn small", onclick: () => void guarded(async () => {
          await api("POST", `/findings/${f.id}/ignore`, { reason: (reasonInput as HTMLInputElement).value });
          toast("Finding ignored");
          onChange();
        }) }, "Ignore as false positive"));

  return h("article", { class: f.ignored ? "finding ignored" : "finding" },
    h("div", { class: "row" },
      h("span", { class: `tag ${f.impact}` }, f.impact),
      h("span", { class: "tag" }, `Level ${f.severity}`),
      h("strong", {}, f.message)),
    h("div", { class: "muted" }, `${f.criterion} ${f.criterionName} on ${f.pagePath || f.pageId}${f.fixApplied ? " (fix applied, re-scan to verify)" : ""}`),
    h("pre", {}, f.snippet || f.selector),
    h("div", { class: "muted" }, f.remediation),
    actions,
    fixBox,
    ignoreBox);
}

async function renderFindings(offset = 0, acc: FindingDto[] = []): Promise<void> {
  const [pages, rules] = await Promise.all([
    api<{ pages: PageResultDto[] }>("GET", "/pages").catch(() => ({ pages: [] as PageResultDto[] })),
    api<{ rules: RuleMetaDto[] }>("GET", "/rules"),
  ]);
  const qs = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (filters.pageId) qs.set("pageId", filters.pageId);
  if (filters.ruleId) qs.set("ruleId", filters.ruleId);
  if (filters.severity) qs.set("severity", filters.severity);
  if (filters.showIgnored) qs.set("ignored", "include");
  let list: FindingListDto = { findings: [], total: 0 };
  try {
    list = await api<FindingListDto>("GET", `/findings?${qs.toString()}`);
  } catch (err) {
    if (!(err instanceof ApiFailure && err.status === 404)) throw err;
  }
  const all = [...acc, ...list.findings];
  const select = (id: string, label: string, options: Array<[string, string]>, value: string, set: (v: string) => void) =>
    h("label", {}, `${label} `, h("select", { id, onchange: (e: Event) => { set((e.target as HTMLSelectElement).value); void guarded(() => renderFindings()); } },
      h("option", { value: "" }, "All"), ...options.map(([v, t]) => h("option", v === value ? { value: v, selected: true } : { value: v }, t))));

  const more = all.length < list.total
    ? h("button", { class: "btn", onclick: () => void guarded(() => renderFindings(all.length, all)) }, `Load more (${list.total - all.length} left)`)
    : null;

  view.replaceChildren(
    h("section", { class: "card" },
      h("div", { class: "row" },
        select("f-page", "Page", pages.pages.map((p) => [p.pageId, p.path || p.title]), filters.pageId, (v) => (filters.pageId = v)),
        select("f-rule", "Rule", rules.rules.map((r) => [r.id, r.title]), filters.ruleId, (v) => (filters.ruleId = v)),
        select("f-sev", "Level", [["A", "A"], ["AA", "AA"], ["AAA", "AAA"]], filters.severity, (v) => (filters.severity = v)),
        h("label", {}, h("input", filters.showIgnored ? { type: "checkbox", checked: true, onchange: (e: Event) => { filters.showIgnored = (e.target as HTMLInputElement).checked; void guarded(() => renderFindings()); } } : { type: "checkbox", onchange: (e: Event) => { filters.showIgnored = (e.target as HTMLInputElement).checked; void guarded(() => renderFindings()); } }), " Show ignored")),
      h("p", { class: "muted" }, `${list.total} findings match.`)),
    ...all.map((f) => findingCard(f, () => void guarded(() => renderFindings()))),
    more
  );
}

async function renderPages(): Promise<void> {
  let pages: PageResultDto[] = [];
  try {
    pages = (await api<{ pages: PageResultDto[] }>("GET", "/pages")).pages;
  } catch (err) {
    if (!(err instanceof ApiFailure && err.status === 404)) throw err;
  }
  view.replaceChildren(
    h("section", { class: "card" }, h("h2", {}, "Page scores"),
      table(["Path", "Score", "Open", "Source", "Notes", ""], pages.map((p) => [
        p.path || p.title,
        p.score === null ? "not audited" : String(p.score),
        String(p.findingCount),
        p.source,
        p.error ?? "",
        h("button", { class: "btn small", onclick: () => void guarded(async () => {
          filters.pageId = p.pageId;
          setTab("findings");
        }) }, "View findings"),
      ]), "Run an audit to see page scores."))
  );
}

async function renderIgnored(): Promise<void> {
  let list: FindingListDto = { findings: [], total: 0 };
  try {
    list = await api<FindingListDto>("GET", "/findings?ignored=only&limit=200");
  } catch (err) {
    if (!(err instanceof ApiFailure && err.status === 404)) throw err;
  }
  const ignores = await api<{ ignores: IgnoreDto[] }>("GET", "/ignores");
  view.replaceChildren(
    h("section", { class: "card" }, h("h2", {}, "Ignored in the latest run"),
      h("p", { class: "muted" }, `${ignores.ignores.length} ignore rules are stored. Ignored findings do not affect scores and appear as accepted exceptions in the statement.`)),
    ...list.findings.map((f) => findingCard(f, () => void guarded(() => renderIgnored()))),
    list.findings.length === 0 ? h("p", { class: "muted" }, "No ignored findings in the latest run.") : null
  );
}

async function renderSettings(): Promise<void> {
  const s = await api<SettingsDto>("GET", "/settings");
  const aaa = h("input", { type: "checkbox", id: "s-aaa" });
  const auto = h("input", { type: "checkbox", id: "s-auto" });
  const drafts = h("input", { type: "checkbox", id: "s-drafts" });
  (aaa as HTMLInputElement).checked = s.includeAAA;
  (auto as HTMLInputElement).checked = s.autoAudit;
  (drafts as HTMLInputElement).checked = s.includeDrafts;
  const max = h("input", { type: "number", id: "s-max", class: "num", min: "1", max: "1000", value: String(s.maxPages) });
  const org = h("input", { id: "s-org", value: s.statementOrg });
  const contact = h("input", { id: "s-contact", value: s.statementContact, placeholder: "accessibility@example.com" });
  view.replaceChildren(
    h("section", { class: "card stack" }, h("h2", {}, "Settings"),
      h("label", {}, aaa, " Also report AAA-only checks (enhanced contrast)"),
      h("label", {}, auto, " Audit automatically after publish and daily"),
      h("label", {}, drafts, " Include draft pages (DOM API only)"),
      h("label", {}, "Max pages per audit ", max),
      h("label", {}, "Organisation name for the statement ", org),
      h("label", {}, "Feedback contact (email or URL) ", contact),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => void guarded(async () => {
        await api<SettingsDto>("PUT", "/settings", {
          includeAAA: (aaa as HTMLInputElement).checked,
          autoAudit: (auto as HTMLInputElement).checked,
          includeDrafts: (drafts as HTMLInputElement).checked,
          maxPages: Number((max as HTMLInputElement).value),
          statementOrg: (org as HTMLInputElement).value,
          statementContact: (contact as HTMLInputElement).value,
        });
        toast("Settings saved");
      }) }, "Save")))
  );
}

function renderCurrent(): Promise<void> {
  window.clearTimeout(pollTimer);
  switch (current) {
    case "overview": return renderOverview();
    case "findings": return renderFindings();
    case "pages": return renderPages();
    case "ignored": return renderIgnored();
    case "settings": return renderSettings();
  }
}

function setTab(tab: Tab): void {
  current = tab;
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  void guarded(renderCurrent);
}

function boot(): void {
  creds = creds ?? loadCreds();
  $<HTMLElement>("connect").hidden = !!creds;
  $<HTMLElement>("main").hidden = !creds;
  if (creds) void guarded(renderCurrent);
}

$<HTMLButtonElement>("conn-save").addEventListener("click", () => {
  const siteId = $<HTMLInputElement>("conn-site").value.trim();
  const token = $<HTMLInputElement>("conn-token").value.trim();
  if (!siteId || !token) return toast("Enter both the Site ID and the admin token", true);
  creds = { siteId, token };
  try {
    sessionStorage.setItem("aa-creds", JSON.stringify(creds));
  } catch {
    /* session storage unavailable; keep in memory */
  }
  boot();
});

$<HTMLElement>("tabs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>(".tab");
  if (btn?.dataset.tab) setTab(btn.dataset.tab as Tab);
});

boot();
