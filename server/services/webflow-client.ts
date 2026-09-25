// Hand-rolled typed client for Webflow Data API v2 (no SDK dependency).
// Cross-cutting: per-site token bucket (60 req/min), refresh-on-401 retry, 429 exponential backoff honoring Retry-After.

import {
  WebflowAsset,
  WebflowAssetListResponse,
  WebflowCollection,
  WebflowCollectionItem,
  WebflowDomNode,
  WebflowDomResponse,
  WebflowPage,
  WebflowPageListResponse,
  WebflowSiteSummary,
  WebflowWebhook,
} from "../../shared/webflow-types";
import { refreshAccessToken } from "./oauth-service";
import { tokenStore } from "./token-store";

const API_BASE = "https://api.webflow.com/v2";
const MAX_429_RETRIES = 5;
const MAX_5XX_RETRIES = 2;
const PAGE_SIZE = 100;

export class WebflowApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Webflow API error ${status}: ${JSON.stringify(body)}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Token bucket sized for Webflow's 60 requests/minute limit: capacity 60, refilling one token per second.
 * block() lets a 429 pause every caller of the same site until the Retry-After window has passed.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private blockedUntil = 0;

  constructor(private capacity = 60, private refillPerMinute = 60) {
    this.tokens = capacity;
  }

  block(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.tokens = 0;
    this.lastRefill = this.blockedUntil;
  }

  private refill(now: number): void {
    if (now <= this.lastRefill) return;
    const gained = ((now - this.lastRefill) / 60000) * this.refillPerMinute;
    this.tokens = Math.min(this.capacity, this.tokens + gained);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(this.blockedUntil - now);
        continue;
      }
      this.refill(now);
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.refillPerMinute) * 60000));
    }
  }
}

const limiters = new Map<string, TokenBucket>();
function limiterFor(siteId: string): TokenBucket {
  let l = limiters.get(siteId);
  if (!l) {
    l = new TokenBucket();
    limiters.set(siteId, l);
  }
  return l;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export class WebflowClient {
  private limiter: TokenBucket;

  constructor(public readonly siteId: string) {
    this.limiter = limiterFor(siteId);
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const qstr = qs.toString();
    const url = `${API_BASE}${path}${qstr ? `?${qstr}` : ""}`;

    let refreshed = false;
    let retries429 = 0;
    let retries5xx = 0;

    for (;;) {
      await this.limiter.acquire();
      const tokens = tokenStore.get(this.siteId);
      if (!tokens) throw new WebflowApiError(401, { message: `No stored token for site ${this.siteId}` });

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        if (await refreshAccessToken(this.siteId)) continue;
      }

      if (res.status === 429 && retries429 < MAX_429_RETRIES) {
        // Exponential backoff (1s, 2s, 4s...) but never shorter than the server's Retry-After.
        const backoff = 1000 * 2 ** retries429;
        const wait = Math.max(backoff, parseRetryAfterMs(res.headers.get("Retry-After")) ?? 0) + Math.floor(Math.random() * 250);
        this.limiter.block(wait);
        retries429++;
        continue;
      }

      if (res.status >= 500 && method === "GET" && retries5xx < MAX_5XX_RETRIES) {
        await sleep(500 * 2 ** retries5xx);
        retries5xx++;
        continue;
      }

      if (!res.ok) throw new WebflowApiError(res.status, await res.json().catch(() => ({})));
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  /** GET /v2/sites/{siteId} */
  getSite(): Promise<WebflowSiteSummary> {
    return this.request("GET", `/sites/${this.siteId}`);
  }

  /** GET /v2/sites/{siteId}/pages, paginated to completion. */
  async listAllPages(): Promise<WebflowPage[]> {
    const all: WebflowPage[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<WebflowPageListResponse>("GET", `/sites/${this.siteId}/pages`, { query: { limit: PAGE_SIZE, offset } });
      all.push(...page.pages);
      offset += PAGE_SIZE;
      if (page.pages.length === 0 || offset >= (page.pagination?.total ?? 0)) return all;
    }
  }

  /** GET /v2/pages/{pageId} */
  getPage(pageId: string): Promise<WebflowPage> {
    return this.request("GET", `/pages/${pageId}`);
  }

  /** GET /v2/pages/{pageId}/dom, paginated to completion (static content nodes with Designer node ids). */
  async getPageDom(pageId: string): Promise<WebflowDomNode[]> {
    const all: WebflowDomNode[] = [];
    let offset = 0;
    for (;;) {
      const res = await this.request<WebflowDomResponse>("GET", `/pages/${pageId}/dom`, { query: { limit: PAGE_SIZE, offset } });
      all.push(...(res.nodes ?? []));
      offset += PAGE_SIZE;
      if ((res.nodes ?? []).length === 0 || offset >= (res.pagination?.total ?? 0)) return all;
    }
  }

  /** GET /v2/sites/{siteId}/assets, paginated (capped at 20 requests). */
  async listAssets(): Promise<WebflowAsset[]> {
    const all: WebflowAsset[] = [];
    let offset = 0;
    for (let i = 0; i < 20; i++) {
      const res = await this.request<WebflowAssetListResponse>("GET", `/sites/${this.siteId}/assets`, { query: { limit: PAGE_SIZE, offset } });
      all.push(...(res.assets ?? []));
      offset += PAGE_SIZE;
      if ((res.assets ?? []).length === 0 || offset >= (res.pagination?.total ?? 0)) break;
    }
    return all;
  }

  /** GET /v2/sites/{siteId}/collections */
  async listCollections(): Promise<WebflowCollection[]> {
    const r = await this.request<{ collections?: WebflowCollection[] }>("GET", `/sites/${this.siteId}/collections`);
    return r.collections ?? [];
  }

  /** GET /v2/collections/{collectionId}/items/live (published items only). */
  async listLiveItems(collectionId: string, limit = 1): Promise<WebflowCollectionItem[]> {
    const r = await this.request<{ items?: WebflowCollectionItem[] }>("GET", `/collections/${collectionId}/items/live`, { query: { limit, offset: 0 } });
    return r.items ?? [];
  }

  async listWebhooks(): Promise<WebflowWebhook[]> {
    const r = await this.request<{ webhooks: WebflowWebhook[] }>("GET", `/sites/${this.siteId}/webhooks`);
    return r.webhooks ?? [];
  }

  createWebhook(triggerType: string, url: string): Promise<WebflowWebhook> {
    return this.request("POST", `/sites/${this.siteId}/webhooks`, { body: { triggerType, url } });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request("DELETE", `/webhooks/${webhookId}`);
  }
}

const clients = new Map<string, WebflowClient>();

export function getClient(siteId: string): WebflowClient {
  let c = clients.get(siteId);
  if (!c) {
    c = new WebflowClient(siteId);
    clients.set(siteId, c);
  }
  return c;
}

export function forgetClient(siteId: string): void {
  clients.delete(siteId);
  limiters.delete(siteId);
}
