// Typed models for the subset of the Webflow Data API v2 this app uses.

export interface WebflowTokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface WebflowSiteSummary {
  id: string;
  displayName?: string;
  shortName?: string;
  customDomains?: Array<{ id: string; url: string }>;
}

export interface WebflowPage {
  id: string;
  siteId?: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  draft?: boolean;
  archived?: boolean;
  /** Present on CMS collection template pages. */
  collectionId?: string | null;
}

export interface WebflowPageListResponse {
  pages: WebflowPage[];
  pagination?: { limit: number; offset: number; total: number };
}

/** Node returned by GET /v2/pages/{pageId}/dom. Only the fields the audit reads are modelled. */
export interface WebflowDomNode {
  id: string;
  type: string;
  text?: { html?: string; text?: string };
  image?: { alt?: string; assetId?: string };
  placeholder?: string;
  attributes?: Array<{ name: string; value: string }> | Record<string, string>;
}

export interface WebflowDomResponse {
  pageId?: string;
  nodes: WebflowDomNode[];
  pagination?: { limit: number; offset: number; total: number };
}

export interface WebflowAsset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  hostedUrl?: string;
  altText?: string | null;
  contentType?: string;
}

export interface WebflowAssetListResponse {
  assets: WebflowAsset[];
  pagination?: { limit: number; offset: number; total: number };
}

export interface WebflowCollection {
  id: string;
  displayName?: string;
  slug?: string;
}

export interface WebflowCollectionItem {
  id: string;
  isDraft?: boolean;
  isArchived?: boolean;
  fieldData?: { name?: string; slug?: string } & Record<string, unknown>;
}

export interface WebflowWebhook {
  id: string;
  triggerType: string;
  url: string;
  siteId?: string;
}

export interface WebflowWebhookEnvelope<T = unknown> {
  triggerType: string;
  payload: T;
}
