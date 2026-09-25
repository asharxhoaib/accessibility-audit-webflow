// Page content ingestion: Pages DOM endpoint (node ids, static content) + published-HTML fetch (full structure and CSS).

import { WebflowAsset, WebflowDomNode, WebflowPage, WebflowSiteSummary } from "../../shared/webflow-types";
import { parseCss } from "./dom/css";
import { parseHtml } from "./dom/html-parser";
import { CssRule, deepText, ElementNode, indexIds, PageModel } from "./dom/model";
import { WebflowApiError, WebflowClient } from "./webflow-client";

const CDN_HOSTS = ["cdn.prod.website-files.com", "assets-global.website-files.com", "uploads-ssl.webflow.com", "d3e54v103j8qbb.cloudfront.net", "cdn.prod.website-files.com"];
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const MAX_STYLESHEETS = 8;

export interface SiteContext {
  client: WebflowClient;
  candidateBaseUrls: string[];
  allowedHosts: Set<string>;
  assets: Map<string, WebflowAsset>;
  cssCache: Map<string, string>;
}

export function buildSiteContext(client: WebflowClient, site: WebflowSiteSummary, assets: WebflowAsset[]): SiteContext {
  const bases: string[] = [];
  for (const d of site.customDomains ?? []) bases.push(/^https?:\/\//i.test(d.url) ? d.url.replace(/\/+$/, "") : `https://${d.url}`);
  if (site.shortName) bases.push(`https://${site.shortName}.webflow.io`);
  const allowed = new Set<string>(CDN_HOSTS);
  for (const b of bases) allowed.add(new URL(b).host);
  return { client, candidateBaseUrls: bases, allowedHosts: allowed, assets: new Map(assets.map((a) => [a.id, a])), cssCache: new Map() };
}

async function fetchText(url: string, allowed: Set<string>, maxBytes: number): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Unsupported URL protocol");
  if (!allowed.has(u.host)) throw new Error(`Host ${u.host} is not one of this site's hosts`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { Accept: "text/html,text/css,*/*", "User-Agent": "accessibility-audit-webflow/1.0" } });
    if (res.url && !allowed.has(new URL(res.url).host)) throw new Error("Redirected to a host outside the site");
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(`Response larger than ${maxBytes} bytes`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function resolvePagePath(ctx: SiteContext, page: WebflowPage): Promise<string | null> {
  if (!page.publishedPath) return null;
  if (!page.collectionId) return page.publishedPath;
  // CMS template page: use the first live item to get a concrete URL.
  try {
    const [item] = await ctx.client.listLiveItems(page.collectionId, 1);
    const slug = item?.fieldData?.slug;
    if (!slug) return null;
    const base = page.publishedPath.replace(/\/(:[\w-]+|\{[^}]+\})$/, "").replace(/\/$/, "");
    return `${base}/${slug}`;
  } catch {
    return null;
  }
}

async function loadStyles(ctx: SiteContext, elements: ElementNode[], pageUrl: string): Promise<CssRule[]> {
  const rules: CssRule[] = [];
  let order = 0;
  const links: string[] = [];
  for (const el of elements) {
    if (el.tag === "style" && el.raw) {
      const parsed = parseCss(el.raw, order);
      order += parsed.length + 1;
      rules.push(...parsed);
    } else if (el.tag === "link" && /stylesheet/i.test(el.attrs.rel ?? "") && el.attrs.href) {
      try {
        links.push(new URL(el.attrs.href, pageUrl).toString());
      } catch {
        /* ignore malformed href */
      }
    }
  }
  // Stylesheets are cascaded in document order; keep the order stable relative to inline blocks by appending after them,
  // which matches Webflow's output (linked site CSS first, small inline overrides later) closely enough for auditing.
  const linked: CssRule[] = [];
  let lorder = 0;
  for (const href of links.slice(0, MAX_STYLESHEETS)) {
    let css = ctx.cssCache.get(href);
    if (css === undefined) {
      try {
        css = await fetchText(href, ctx.allowedHosts, MAX_CSS_BYTES);
      } catch {
        css = "";
      }
      ctx.cssCache.set(href, css);
    }
    const parsed = parseCss(css, lorder);
    lorder += parsed.length + 1;
    linked.push(...parsed);
  }
  const shift = lorder + 1;
  return [...linked, ...rules.map((r) => ({ ...r, order: r.order + shift }))];
}

function domAttrs(node: WebflowDomNode): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(node.attributes)) for (const a of node.attributes) out[a.name.toLowerCase()] = a.value;
  else if (node.attributes) for (const [k, v] of Object.entries(node.attributes)) out[k.toLowerCase()] = String(v);
  return out;
}

const baseName = (u: string) => decodeURIComponent(u.split("?")[0].split("/").pop() ?? "").toLowerCase();

/** Attaches Designer node ids to parsed published elements. */
function mapNodeIds(page: PageModel, nodes: WebflowDomNode[], assets: Map<string, WebflowAsset>): void {
  const texts = new Map<number, string>();
  const textOf = (i: number) => {
    let t = texts.get(i);
    if (t === undefined) {
      t = norm(deepText(page, i));
      texts.set(i, t);
    }
    return t;
  };
  const claimed = new Set<number>();
  for (const node of nodes) {
    let match = -1;
    const wid = page.elements.findIndex((e) => e.attrs["data-w-id"] === node.id && !claimed.has(e.idx));
    if (wid >= 0) match = wid;
    else if (node.image) {
      const asset = node.image.assetId ? assets.get(node.image.assetId) : undefined;
      const name = asset?.hostedUrl ? baseName(asset.hostedUrl) : "";
      if (name) match = page.elements.findIndex((e) => e.tag === "img" && !claimed.has(e.idx) && baseName(e.attrs.src ?? "") === name);
    } else if (node.text?.text) {
      const want = norm(node.text.text);
      if (want) {
        for (const e of page.elements) {
          if (claimed.has(e.idx) || textOf(e.idx) !== want) continue;
          // Prefer the deepest element carrying exactly this text.
          if (e.children.some((c) => textOf(c) === want)) continue;
          match = e.idx;
          break;
        }
      }
    }
    if (match >= 0) {
      claimed.add(match);
      page.elements[match].nodeId = node.id;
    }
  }
}

/** Builds a model from DOM nodes alone (unpublished pages, or when the published fetch fails). */
function modelFromDom(base: Omit<PageModel, "elements" | "byId" | "hasDocument" | "rules" | "stylesLoaded" | "source">, nodes: WebflowDomNode[], assets: Map<string, WebflowAsset>): PageModel {
  const elements: ElementNode[] = [{ idx: 0, tag: "body", attrs: {}, parent: -1, children: [], text: "" }];
  for (const node of nodes) {
    const attrs = domAttrs(node);
    const start = elements.length;
    if (node.image) {
      const asset = node.image.assetId ? assets.get(node.image.assetId) : undefined;
      const alt = node.image.alt ?? asset?.altText ?? undefined;
      const img: ElementNode = { idx: start, tag: "img", attrs: { ...attrs, ...(alt !== undefined && alt !== null ? { alt } : {}), src: asset?.hostedUrl ?? "" }, parent: 0, children: [], text: "", nodeId: node.id };
      elements.push(img);
      elements[0].children.push(start);
    } else if (node.text?.html || node.text?.text) {
      const html = node.text.html ?? "";
      if (/^\s*</.test(html)) parseHtml(html, elements, 0);
      else {
        elements.push({ idx: start, tag: "p", attrs: {}, parent: 0, children: [], text: node.text.text ?? html });
        elements[0].children.push(start);
      }
      if (elements.length > start) elements[start].nodeId = node.id;
    } else if (node.placeholder !== undefined || /input|field|select|textarea/i.test(node.type)) {
      const tag = /select/i.test(node.type) ? "select" : /textarea/i.test(node.type) ? "textarea" : "input";
      elements.push({ idx: start, tag, attrs: { ...attrs, ...(node.placeholder ? { placeholder: node.placeholder } : {}) }, parent: 0, children: [], text: "", nodeId: node.id });
      elements[0].children.push(start);
    }
  }
  const page: PageModel = { ...base, source: "dom-api", hasDocument: false, elements, rules: [], stylesLoaded: false, byId: new Map() };
  indexIds(page);
  return page;
}

export interface BuiltPage {
  model: PageModel | null;
  url: string;
  source: string;
  error: string | null;
}

/** Builds the model for one page. Never throws for content problems; returns an error string instead. */
export async function buildPageModel(ctx: SiteContext, page: WebflowPage, includeDrafts: boolean): Promise<BuiltPage> {
  const path = await resolvePagePath(ctx, page);
  let nodes: WebflowDomNode[] | null = null;
  try {
    nodes = await ctx.client.getPageDom(page.id);
  } catch (err) {
    if (err instanceof WebflowApiError && (err.status === 401 || err.status === 403)) throw err;
    nodes = null;
  }
  const base = { pageId: page.id, title: page.title, path: page.publishedPath ?? `/${page.slug}` };
  const publishable = !!path && !page.draft && !page.archived;

  if (publishable && path) {
    for (const origin of ctx.candidateBaseUrls) {
      const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
      try {
        const html = await fetchText(url, ctx.allowedHosts, MAX_HTML_BYTES);
        const elements = parseHtml(html);
        const rules = await loadStyles(ctx, elements, url);
        const model: PageModel = {
          ...base,
          url,
          source: "published-html",
          hasDocument: elements.some((e) => e.tag === "html") || elements.some((e) => e.tag === "body"),
          elements,
          rules,
          stylesLoaded: rules.length > 0,
          byId: new Map(),
        };
        indexIds(model);
        if (nodes) mapNodeIds(model, nodes, ctx.assets);
        applyAssetAlt(model, ctx.assets);
        return { model, url, source: "published-html", error: null };
      } catch {
        /* try the next candidate origin */
      }
    }
  }

  if (nodes && nodes.length > 0 && (includeDrafts || publishable)) {
    const model = modelFromDom({ ...base, url: "" }, nodes, ctx.assets);
    return { model, url: "", source: "dom-api", error: publishable ? "Published HTML was unreachable; audited from the Pages DOM API only (no CSS or landmark checks)." : null };
  }
  if (nodes && nodes.length > 0 && !includeDrafts) return { model: null, url: "", source: "none", error: "Page is not published. Enable \"Include drafts\" to audit it from the Pages DOM API." };
  return { model: null, url: "", source: "none", error: nodes === null ? "Page content could not be read from the Pages DOM API and the page is not published." : "Page has no auditable content." };
}

/** Library alt text supplied through assets:read counts when the published markup somehow omits it. */
function applyAssetAlt(model: PageModel, assets: Map<string, WebflowAsset>): void {
  const byName = new Map<string, string>();
  for (const a of assets.values()) if (a.hostedUrl && a.altText) byName.set(baseName(a.hostedUrl), a.altText);
  if (byName.size === 0) return;
  for (const el of model.elements) {
    if (el.tag === "img" && el.attrs.alt === undefined) {
      const alt = byName.get(baseName(el.attrs.src ?? ""));
      if (alt) el.attrs.alt = alt;
    }
  }
}
