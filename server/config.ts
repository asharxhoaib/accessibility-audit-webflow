import "dotenv/config";

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 3000),
  publicUrl: (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, ""),
  webflow: {
    clientId: process.env.WEBFLOW_CLIENT_ID || "",
    clientSecret: process.env.WEBFLOW_CLIENT_SECRET || "",
    redirectUri: process.env.WEBFLOW_REDIRECT_URI || "http://localhost:3000/oauth/callback",
    scopes: (process.env.WEBFLOW_SCOPES || "pages:read,pages:write,cms:read,sites:read,assets:read").split(",").map((s) => s.trim()).filter(Boolean),
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "dev-only-insecure-key",
  audit: {
    scheduleCheckMin: Math.max(1, num(process.env.SCHEDULE_CHECK_INTERVAL_MIN, 60)),
    autoAuditEveryHours: Math.max(1, num(process.env.AUTO_AUDIT_EVERY_HOURS, 24)),
    publishDelaySec: Math.max(0, num(process.env.PUBLISH_AUDIT_DELAY_SEC, 45)),
    runRetentionCount: Math.max(2, Math.floor(num(process.env.RUN_RETENTION_COUNT, 60))),
    maxPagesPerRun: Math.max(1, Math.floor(num(process.env.MAX_PAGES_PER_RUN, 200))),
  },
};
