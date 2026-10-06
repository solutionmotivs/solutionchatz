// In-process scheduler for the recurring jobs (webhook delivery, ERP sync, escrow deadlines, slow-transfer watchdog, certificate poll,
// sanctions list sync and re-screening). Enabled with ENABLE_INTERNAL_SCHEDULER=true on an always-on instance. Several instances are safe:
// each run first takes a database lease, so a job runs on one instance at a time. The same jobs can instead be called by an external cron
// (POST /api/internal/<job> with x-cron-secret): see docs/OPERATIONS.md. A sleeping free-tier instance does not run timers: use an external cron there.
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

export interface JobDef { name: string; everyMs: number; leaseMs: number; run: () => Promise<unknown> }

const min = 60_000, hour = 60 * min;
export const JOBS: JobDef[] = [
  { name: "webhooks", everyMs: 1 * min, leaseMs: 5 * min, run: async () => (await import("@/lib/webhooks/dispatch")).processDueWebhooks() },
  { name: "erp-sync", everyMs: 15 * min, leaseMs: 20 * min, run: async () => (await import("@/lib/erp/sync")).syncAllConnections() },
  { name: "slow-transfers", everyMs: 10 * min, leaseMs: 5 * min, run: async () => (await import("@/lib/routing/settlement-metrics")).runSlowTransferWatchdog() },
  { name: "escrow-deadlines", everyMs: 1 * hour, leaseMs: 15 * min, run: async () => (await import("@/lib/escrow/service")).runDeemedApprovals() },
  { name: "certificate-poll", everyMs: 1 * hour, leaseMs: 30 * min, run: async () => (await import("@/lib/documents/poll")).runCertificatePoll() },
  // One list per run keeps peak memory low on small instances; each skips the download when the list is unchanged.
  { name: "sanctions-ofac", everyMs: 24 * hour, leaseMs: 30 * min, run: async () => (await import("@/lib/sanctions/sync")).syncList("OFAC_SDN", {}) },
  { name: "sanctions-un", everyMs: 24 * hour, leaseMs: 30 * min, run: async () => (await import("@/lib/sanctions/sync")).syncList("UN", {}) },
  { name: "sanctions-uk", everyMs: 24 * hour, leaseMs: 30 * min, run: async () => (await import("@/lib/sanctions/sync")).syncList("UK", {}) },
  { name: "sanctions-rescreen", everyMs: 24 * hour, leaseMs: 60 * min, run: async () => (await import("@/lib/sanctions/rescreen")).rescreenAll() },
];

const owner = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Take the lease if it is free or expired. */
async function acquire(job: JobDef, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + job.leaseMs);
  try { await db.jobLease.create({ data: { name: job.name, lockedUntil: until, owner } }); return true; } catch { /* row exists */ }
  const r = await db.jobLease.updateMany({ where: { name: job.name, lockedUntil: { lt: now } }, data: { lockedUntil: until, owner } });
  return r.count === 1;
}

export async function runJobOnce(name: string, opts: { force?: boolean } = {}): Promise<{ name: string; status: "ran" | "skipped" | "failed"; ms?: number; result?: unknown; error?: string }> {
  const job = JOBS.find(j => j.name === name);
  if (!job) throw new Error(`unknown job ${name}`);
  if (!opts.force) {
    const lease = await db.jobLease.findUnique({ where: { name } });
    if (lease?.lastRunAt && Date.now() - lease.lastRunAt.getTime() < job.everyMs * 0.9) return { name, status: "skipped" }; // another instance ran it recently
  }
  if (!(await acquire(job))) return { name, status: "skipped" };
  const t0 = Date.now();
  try {
    const result = await job.run();
    const ms = Date.now() - t0;
    await db.jobLease.update({ where: { name }, data: { lockedUntil: new Date(), lastRunAt: new Date(), lastOk: true, lastResult: JSON.parse(JSON.stringify(result ?? null)), lastMs: ms } });
    return { name, status: "ran", ms, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
    log("error", "scheduled job failed", { job: name, error: msg });
    await db.jobLease.update({ where: { name }, data: { lockedUntil: new Date(), lastRunAt: new Date(), lastOk: false, lastResult: { error: msg }, lastMs: Date.now() - t0 } }).catch(() => {});
    return { name, status: "failed", error: msg };
  }
}

let started = false;
export function startScheduler(jobs: JobDef[] = JOBS) {
  if (started) return;
  started = true;
  for (const [i, j] of jobs.entries()) {
    // Stagger the first runs so a restart does not start everything (and the large downloads) at once.
    const first = setTimeout(() => { void runJobOnce(j.name); setInterval(() => void runJobOnce(j.name), j.everyMs).unref?.(); }, 20_000 + i * 15_000);
    first.unref?.();
  }
  log("info", "internal scheduler started", { jobs: jobs.map(j => j.name) });
}
