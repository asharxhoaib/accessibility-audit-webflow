import { Router } from "express";
import { config } from "../config";
import { db } from "../db";
import { schedulePublishAudit } from "../services/audit";
import { asyncHandler } from "../services/errors";
import { purgeInstallation } from "../services/install";
import { verifyWebflowSignature } from "../services/webhook-verify";

// Mounted behind express.raw() in index.ts so signatures are checked against the exact bytes received.
const router = Router();

router.post("/:siteId/:event", asyncHandler(async (req, res) => {
  const { siteId, event } = req.params;
  const raw = req.body as Buffer;
  if (!verifyWebflowSignature(raw, req.header("x-webflow-signature"), req.header("x-webflow-timestamp"), config.webflow.clientSecret)) {
    return void res.status(401).json({ error: "Invalid signature" });
  }
  if (event === "app-uninstalled") {
    purgeInstallation(siteId);
    return void res.json({ ok: true });
  }
  if (!db.get(`SELECT 1 AS x FROM installations WHERE site_id = ?`, [siteId])) return void res.status(202).json({ ok: true, ignored: "site not installed" });
  if (event === "site-publish") {
    // Acknowledge immediately; the audit runs later (debounced) so the published CDN copy is current.
    res.json({ ok: true });
    schedulePublishAudit(siteId);
    return;
  }
  res.status(404).json({ error: "Unknown event" });
}));

export default router;
