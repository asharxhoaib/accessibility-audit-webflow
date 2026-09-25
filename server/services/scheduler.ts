import { config } from "../config";
import { db } from "../db";
import { pruneRuns, sitesDueForAudit, startAudit, isAuditRunning } from "./audit";

function every(minutes: number, name: string, fn: () => void | Promise<void>): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[job:${name}] failed:`, err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, minutes * 60000).unref();
}

export function startJobs(): void {
  every(config.audit.scheduleCheckMin, "scheduled-audits", () => {
    for (const siteId of sitesDueForAudit()) {
      if (isAuditRunning(siteId)) continue;
      startAudit(siteId, "schedule");
    }
  });
  every(360, "run-retention", () => {
    for (const { site_id } of db.all<{ site_id: string }>(`SELECT site_id FROM installations`)) pruneRuns(site_id);
    db.run(`DELETE FROM oauth_states WHERE created_at < ?`, [Date.now() - 3600000]);
  });
}
